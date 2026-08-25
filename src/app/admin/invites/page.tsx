import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isAdmin } from "@/lib/admin-guard";
import { Eyebrow, Card } from "@/components/ui";
import { formatInviteCode, inviteState } from "@/lib/salon-invite";
import SentToggle from "./SentToggle";

/**
 * サロン招待の管理（/admin/invites・echo Labs 運営者のみ / migration 0043）。
 *
 * ★非運営者には notFound() ＝ HTTP 404★
 *   403 だと「このURLは存在する」というオラクルになる。未ログイン・一般客・サロン店長を
 *   すべて 404 で畳み、運営画面の存在自体を伏せる（@/lib/admin-guard）。
 *   staff.role は見ない（env ADMIN_LINE_USER_IDS だけで判定）。
 *
 * 一覧の項目: 招待コード / 宛先メール / 送信済(チェック) / 発行日 / 期限 /
 *             登録状態 / 登録日 / サロン名 / スタッフ人数
 * 期限切れ行はグレーアウトし「復旧」（expires_at を now+14日に延長）を出す。
 * メール送信機能は持たない（sent_at は手動チェックのみ）。
 *
 * トーン: 管理＝ダーク寄りだが、ここは既存の管理画面と同じ明るい世界のカードUIに揃える。
 * §7 インライン style 禁止・赤なし（期限切れは褪せたグレーで表現・docs/30_design.md §2）。
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
  salon_id: string | null;
  salons: { name: string } | { name: string }[] | null;
};

const ERROR_MESSAGE: Record<string, string> = {
  form: "送信データを読み取れませんでした。",
  id: "対象を特定できませんでした。",
  email: "宛先メールが長すぎます。",
  save: "保存に失敗しました。時間をおいて再度お試しください。",
  restore_used: "使用済みの招待は復旧できません。",
};

/** JST の日付表示（YYYY/MM/DD）。ダッシュボードと同じ Asia/Tokyo 基準。 */
const jstDate = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function fmt(iso: string | null): string {
  return iso ? jstDate.format(new Date(iso)) : "—";
}

function one<T>(v: T | T[] | null): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export default async function AdminInvitesPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; error?: string; restored?: string }>;
}) {
  const { created, error, restored } = await searchParams;

  // 非運営者はここで 404。以降の DB アクセスには絶対に到達させない。
  if (!(await isAdmin())) notFound();

  const { data } = await supabaseAdmin
    .from("salon_invites")
    .select(
      "id, code, recipient_email, sent_at, created_at, expires_at, used_at, salon_id, salons(name)",
    )
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as InviteRow[];

  // スタッフ人数は staff を salon_id で数える（在籍のみ＝退職者は除く）。
  // 招待ごとに1クエリ投げると N+1 になるので、1回引いて JS で集計する。
  const usedSalonIds = rows
    .map((r) => r.salon_id)
    .filter((v): v is string => !!v);

  const staffCount = new Map<string, number>();
  if (usedSalonIds.length > 0) {
    const { data: staffRows } = await supabaseAdmin
      .from("staff")
      .select("salon_id")
      .in("salon_id", usedSalonIds)
      .is("archived_at", null);
    for (const s of staffRows ?? []) {
      staffCount.set(s.salon_id, (staffCount.get(s.salon_id) ?? 0) + 1);
    }
  }

  const now = Date.now();

  return (
    <main className="page page-top">
      <div className="container container-wide stack animate-in">
        <header className="stack-sm">
          <Eyebrow>Admin</Eyebrow>
          <h1 className="headline">サロン招待の管理</h1>
          <p className="muted">
            招待コードを持つ人だけがサロンを作成できます。メールの送信は行いません（「送信済」は手動の記録です）。
          </p>
        </header>

        {error && (
          <div className="notice notice-error">
            {ERROR_MESSAGE[error] ?? "エラーが発生しました。"}
          </div>
        )}
        {restored && (
          <div className="notice notice-success">
            期限を14日間延長しました（コードは同じままです）。
          </div>
        )}
        {created && (
          <div className="notice notice-success">
            招待コードを発行しました：
            <strong className="admin-code-strong">
              {formatInviteCode(created)}
            </strong>
          </div>
        )}

        {/* 新規発行 */}
        <Card>
          <form
            action="/api/admin/invites"
            method="post"
            className="stack-md"
          >
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
              招待コードを発行（有効期限14日）
            </button>
          </form>
        </Card>

        {rows.length === 0 ? (
          <p className="muted center-text">まだ招待はありません。</p>
        ) : (
          <div className="stack-sm">
            {rows.map((r) => {
              const state = inviteState(r, now);
              const salonName = one(r.salons)?.name ?? null;
              const count = r.salon_id
                ? (staffCount.get(r.salon_id) ?? 0)
                : null;

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
                      <span className="admin-code">
                        {formatInviteCode(r.code)}
                      </span>
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
                          ? "登録済"
                          : state === "expired"
                            ? "期限切れ"
                            : "未登録"}
                      </span>
                      {state !== "used" && <SentToggle id={r.id} checked={!!r.sent_at} />}
                    </div>

                    <dl className="admin-meta">
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
                        <dt>登録日</dt>
                        <dd>{fmt(r.used_at)}</dd>
                      </div>
                      <div className="admin-meta-item">
                        <dt>サロン名</dt>
                        <dd>{salonName ?? "—"}</dd>
                      </div>
                      <div className="admin-meta-item">
                        <dt>スタッフ人数</dt>
                        <dd>{count === null ? "—" : `${count}名`}</dd>
                      </div>
                    </dl>

                    {state === "expired" && (
                      <form
                        action="/api/admin/invites/restore"
                        method="post"
                        className="archived-restore"
                      >
                        <input type="hidden" name="id" value={r.id} />
                        <button
                          type="submit"
                          className="btn btn-subtle btn-block"
                        >
                          復旧（期限を14日延長）
                        </button>
                      </form>
                    )}
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
