import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isAdmin } from "@/lib/admin-guard";
import { Eyebrow, Card } from "@/components/ui";
import {
  formatInviteCode,
  inviteState,
  maskInviteCode,
} from "@/lib/owner-invite";
import SentToggle from "../invites/SentToggle";

/**
 * オーナー招待の管理（/admin/owner-invites・echo Labs 運営者のみ・§21 コミット5d・migration 0050）。
 *
 * ★非運営者には notFound() ＝ HTTP 404★（/admin/invites と同じ作法・導線は張らない）。
 *
 * 一覧の項目: コード / 状態（未使用・使用済み・期限切れ）/ 組織 / 発行日 / 期限 / 使用日 / 宛先メモ / 送信済み。
 *   ・★誰が使ったかは出さない★ used_member_id も organization_members.line_user_id も select しない。
 *   ・★コードの全文を出すのは未使用のものだけ★ 使用済み・期限切れは末尾4文字だけ（2026-10-01 決定）。
 *     マスクはデータを引く関数（loadOwnerInvites）の中で行うので、使えないコードの全文は描画にも HTML にも渡らない。
 *   ・組織には「n店舗・オーナーm名・未使用の招待n本」を添える（本数は制限しない代わりに見えるようにする）。
 *
 * ★発行直後のコードを URL に載せない★
 *   API は ?created=1 だけを返し、ここは「1かどうか」だけを見る。コードは一覧の先頭の行で見せる
 *   （/admin/invites の ?created=<code> の形は真似しない・`50_security.md` §5 囲みA・§5-7）。
 *
 * 5d に入れないもの: 期限切れの復旧・取り消し（無効化）・削除（漏れたときはレビュー済みの SQL で対応）、
 *   消費（/owner/join・5e）。
 *
 * §7 インライン style 禁止・赤なし（期限切れは褪せたグレー・docs/30_design.md §2）。
 */
export const dynamic = "force-dynamic";

type InviteRow = {
  id: string;
  code: string;
  recipient_email: string | null;
  sent_at: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  org_id: string;
};

type OrgStats = {
  id: string;
  name: string;
  salonCount: number | null;
  ownerCount: number | null;
  usableInvites: number;
};

const ERROR_MESSAGE: Record<string, string> = {
  form: "送信データを読み取れませんでした。",
  id: "対象を特定できませんでした。",
  email: "宛先メールが長すぎます。",
  org: "組織を選んでください（選んだ組織が見つかりませんでした）。",
  save: "保存に失敗しました。時間をおいて再度お試しください。",
};

/** JST の日付表示（YYYY/MM/DD）。/admin/invites と同じ Asia/Tokyo 基準。 */
const jstDate = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function fmt(iso: string | null): string {
  return iso ? jstDate.format(new Date(iso)) : "—";
}

/** org_id の列だけの行を数える。取得に失敗したら null（0 と区別して「—」を出す）。 */
function countByOrg(
  rows: { org_id: string | null }[] | null,
  failed: boolean,
): Map<string, number> | null {
  if (failed) return null;
  const m = new Map<string, number>();
  for (const r of rows ?? []) {
    if (!r.org_id) continue;
    m.set(r.org_id, (m.get(r.org_id) ?? 0) + 1);
  }
  return m;
}

function orgLabel(o: OrgStats): string {
  const salons = o.salonCount === null ? "—" : `${o.salonCount}店舗`;
  const owners = o.ownerCount === null ? "—" : `オーナー${o.ownerCount}名`;
  return `${o.name}（${salons}・${owners}・未使用の招待${o.usableInvites}本）`;
}

/**
 * 一覧と組織の選択肢に必要なものを引く（描画の外で行う＝Date.now() を描画中に呼ばない）。
 */
async function loadOwnerInvites() {
  const [inviteRes, orgRes, salonRes, memberRes] = await Promise.all([
    // ★used_member_id は引かない★（誰が使ったかを出さない）
    supabaseAdmin
      .from("owner_invites")
      .select(
        "id, code, recipient_email, sent_at, created_at, expires_at, used_at, org_id",
      )
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("organizations")
      .select("id, name")
      .order("created_at", { ascending: true }),
    supabaseAdmin.from("salons").select("org_id"),
    // ★org_id だけ★ line_user_id は引かない。
    supabaseAdmin.from("organization_members").select("org_id"),
  ]);

  for (const [label, res] of [
    ["owner_invites", inviteRes],
    ["organizations", orgRes],
    ["salons", salonRes],
    ["organization_members", memberRes],
  ] as const) {
    if (res.error) {
      console.error(`[admin/owner-invites] ${label} の取得に失敗:`, {
        code: res.error.code,
      });
    }
  }

  const rows = (inviteRes.data ?? []) as InviteRow[];
  // 状態（未使用・使用済み・期限切れ）はここで1回だけ決め、描画では判定し直さない。
  const now = Date.now();

  const salonCount = countByOrg(
    salonRes.data as { org_id: string | null }[] | null,
    !!salonRes.error,
  );
  const ownerCount = countByOrg(
    memberRes.data as { org_id: string | null }[] | null,
    !!memberRes.error,
  );
  const usableByOrg = new Map<string, number>();
  for (const r of rows) {
    if (inviteState(r, now) !== "usable") continue;
    usableByOrg.set(r.org_id, (usableByOrg.get(r.org_id) ?? 0) + 1);
  }

  const orgs: OrgStats[] = ((orgRes.data ?? []) as { id: string; name: string }[]).map(
    (o) => ({
      id: o.id,
      name: o.name,
      salonCount: salonCount ? (salonCount.get(o.id) ?? 0) : null,
      ownerCount: ownerCount ? (ownerCount.get(o.id) ?? 0) : null,
      usableInvites: usableByOrg.get(o.id) ?? 0,
    }),
  );

  // ★表示用のコードはここで作り、全文（code）は描画側に渡さない★
  //   未使用だけ全文・使用済み／期限切れは末尾4文字（2026-10-01 決定）。
  const items = rows.map(({ code, ...rest }) => {
    const state = inviteState(rest, now);
    return {
      ...rest,
      state,
      displayCode: state === "usable" ? formatInviteCode(code) : maskInviteCode(code),
    };
  });
  return {
    items,
    orgs,
    listFailed: !!inviteRes.error || !!orgRes.error,
    listEmpty: !inviteRes.error && rows.length === 0,
  };
}

export default async function AdminOwnerInvitesPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; error?: string }>;
}) {
  const { created, error } = await searchParams;

  // 非運営者はここで 404。以降の DB アクセスには絶対に到達させない。
  if (!(await isAdmin())) notFound();

  const { items, orgs, listFailed, listEmpty } = await loadOwnerInvites();
  const orgById = new Map(orgs.map((o) => [o.id, o]));

  return (
    <main className="page page-top">
      <div className="container container-wide stack animate-in">
        <header className="stack-sm">
          <Eyebrow>Admin</Eyebrow>
          <h1 className="headline">オーナー招待の管理</h1>
          <p className="muted">
            招待コードを使った人が、その組織のオーナーになります（スタッフ登録の有無は問いません）。コードは秘密の値として扱ってください。メールの送信は行いません（「送信済」は手動の記録です）。
          </p>
        </header>

        {error && (
          <div className="notice notice-error">
            {/* 表に無いキー（`constructor` 等の継承プロパティを含む）は汎用文言に畳む。 */}
            {(Object.hasOwn(ERROR_MESSAGE, error) && ERROR_MESSAGE[error]) ||
              "エラーが発生しました。"}
          </div>
        )}
        {created === "1" && (
          <div className="notice notice-success">
            オーナー招待を発行しました。一覧の先頭（未使用）のコードを送ってください。
          </div>
        )}
        {listFailed && (
          <div className="notice notice-error">
            一覧を読み込めませんでした。時間をおいて再度お試しください。
          </div>
        )}

        {/* 新規発行 */}
        <Card>
          <form
            action="/api/admin/owner-invites"
            method="post"
            className="stack-md"
          >
            {/* 組織（必須）。先頭は空の選択肢で disabled＝未選択のままでは送信できない。
                可否の最終判定は API 側（organizations に実在するか）が行う。 */}
            <div className="field-group">
              <label className="field-label" htmlFor="org_id">
                組織（必須）
              </label>
              <select
                id="org_id"
                name="org_id"
                className="field"
                defaultValue=""
                required
              >
                <option value="" disabled>
                  選択してください
                </option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {orgLabel(o)}
                  </option>
                ))}
              </select>
              <span className="field-help">
                このコードを使った人がオーナーになる組織です。すでにオーナーがいる組織や、未使用の招待がある組織にも発行できます。
              </span>
            </div>

            <div className="field-group">
              <label className="field-label" htmlFor="recipient_email">
                宛先メール（任意・メモ）
              </label>
              <input
                id="recipient_email"
                name="recipient_email"
                className="field"
                type="email"
                maxLength={254}
                placeholder="owner@example.com"
              />
              <span className="field-help">
                誰に渡す招待かを控えるためだけの欄です。空でも発行できます。
              </span>
            </div>
            <button type="submit" className="btn btn-outline btn-block">
              オーナー招待を発行（有効期限14日）
            </button>
          </form>
        </Card>

        {listEmpty ? (
          <p className="muted center-text">まだオーナー招待はありません。</p>
        ) : (
          <div className="stack-sm">
            {items.map((r) => {
              const state = r.state;
              const org = orgById.get(r.org_id);

              return (
                <Card key={r.id}>
                  <div
                    className={
                      state === "expired"
                        ? "admin-invite is-expired"
                        : "admin-invite"
                    }
                  >
                    <div className="admin-invite-head">
                      <span className="admin-code">{r.displayCode}</span>
                      <span
                        className={
                          state === "used"
                            ? "status-pill is-bound"
                            : state === "expired"
                              ? "status-pill is-expired"
                              : "status-pill"
                        }
                      >
                        {state === "used"
                          ? "使用済み"
                          : state === "expired"
                            ? "期限切れ"
                            : "未使用"}
                      </span>
                      {state === "usable" && (
                        <SentToggle
                          id={r.id}
                          checked={!!r.sent_at}
                          action="/api/admin/owner-invites/sent"
                        />
                      )}
                    </div>

                    <dl className="admin-meta">
                      <div className="admin-meta-item">
                        <dt>組織</dt>
                        <dd>{org ? orgLabel(org) : "—"}</dd>
                      </div>
                      <div className="admin-meta-item">
                        <dt>宛先メール</dt>
                        <dd>{r.recipient_email ?? "—"}</dd>
                      </div>
                      <div className="admin-meta-item">
                        <dt>発行日</dt>
                        <dd>{fmt(r.created_at)}</dd>
                      </div>
                      <div className="admin-meta-item">
                        <dt>期限</dt>
                        <dd>{fmt(r.expires_at)}</dd>
                      </div>
                      <div className="admin-meta-item">
                        <dt>使用日</dt>
                        <dd>{fmt(r.used_at)}</dd>
                      </div>
                    </dl>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
