import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isAdmin } from "@/lib/admin-guard";
import { Eyebrow, Card } from "@/components/ui";
import { ORGANIZATION_NAME_MAX } from "@/lib/organization-name";

/**
 * 組織の管理（/admin/organizations・echo Labs 運営者のみ・§21 コミット5b・migration 0048）。
 *
 * ★非運営者には notFound() ＝ HTTP 404★
 *   /admin/invites と同じ作法（@/lib/admin-guard・env ADMIN_LINE_USER_IDS だけで判定）。
 *   導線は張らない（URL直打ち専用）。
 *
 * 一覧の項目: 組織名 / 作成日 / 店舗数 / オーナーの数（2026-10-01 決定）。並びは作成順。
 *   ・店舗数は salons の org_id だけを1回引いて JS で数える（/admin/invites の「（n店舗）」と同じ数え方）。
 *   ・オーナーの数は organization_members の **org_id 列だけ**を引いて数える。
 *     line_user_id（PII・原則7）は select しない＝取得も表示もしない。
 *   ・未使用のサロン招待の数は出さない（/admin/invites で見られる）。
 *
 * 組織名は屋号でもよい（2026-10-01 決定・§21「2026-10-01 決定（組織名は屋号でもよい）」）。契約主体は別に記録する。
 *
 * ★?created= は「1かどうか」だけを見る★
 *   ID や名前をクエリで受け取って画面に出さない（`50_security.md` §5 囲みA・§5-7 と同じ抜けを作らない）。
 *
 * この画面に無いもの（§21 5b の範囲外）: オーナー招待の発行（5d）・組織名の修正（5c）・
 *   組織の削除・サロンの組織移動（§8.1「機能として作らない」）。
 *
 * §7 インライン style 禁止・赤なし（docs/30_design.md §2）。
 */
export const dynamic = "force-dynamic";

type OrgRow = { id: string; name: string; created_at: string };

const ERROR_MESSAGE: Record<string, string> = {
  form: "送信データを読み取れませんでした。",
  name_empty: "組織名を入力してください。",
  name_long: `組織名は${ORGANIZATION_NAME_MAX}文字以内で入力してください。`,
  name_invalid: "組織名に改行などの使えない文字が含まれています。",
  duplicate: "同じ名前の組織がすでにあります。",
  save: "保存に失敗しました。時間をおいて再度お試しください。",
};

/** JST の日付表示（YYYY/MM/DD）。/admin/invites と同じ Asia/Tokyo 基準。 */
const jstDate = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

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

export default async function AdminOrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; error?: string }>;
}) {
  const { created, error } = await searchParams;

  // 非運営者はここで 404。以降の DB アクセスには絶対に到達させない。
  if (!(await isAdmin())) notFound();

  const [orgRes, salonRes, memberRes] = await Promise.all([
    supabaseAdmin
      .from("organizations")
      .select("id, name, created_at")
      .order("created_at", { ascending: true }),
    supabaseAdmin.from("salons").select("org_id"),
    // ★org_id だけ★ line_user_id は引かない。
    supabaseAdmin.from("organization_members").select("org_id"),
  ]);

  for (const [label, res] of [
    ["organizations", orgRes],
    ["salons", salonRes],
    ["organization_members", memberRes],
  ] as const) {
    if (res.error) {
      console.error(`[admin/organizations] ${label} の取得に失敗:`, {
        code: res.error.code,
      });
    }
  }

  const orgs = (orgRes.data ?? []) as OrgRow[];
  const salonCount = countByOrg(
    salonRes.data as { org_id: string | null }[] | null,
    !!salonRes.error,
  );
  const ownerCount = countByOrg(
    memberRes.data as { org_id: string | null }[] | null,
    !!memberRes.error,
  );

  return (
    <main className="page page-top">
      <div className="container container-wide stack animate-in">
        <header className="stack-sm">
          <Eyebrow>Admin</Eyebrow>
          <h1 className="headline">組織の管理</h1>
          <p className="muted">
            組織は契約主体（事業者）ごとに1つ作ります。組織名は屋号でかまいません（契約主体は別に記録します）。作った組織は、サロン招待の発行先として選べるようになります。
            オーナーの登録はオーナー招待で行います。
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
          <div className="notice notice-success">組織を作成しました。</div>
        )}
        {orgRes.error && (
          <div className="notice notice-error">
            組織の一覧を読み込めませんでした。時間をおいて再度お試しください。
          </div>
        )}

        {/* 新規作成 */}
        <Card>
          <form
            action="/api/admin/organizations"
            method="post"
            className="stack-md"
          >
            <div className="field-group">
              <label className="field-label" htmlFor="name">
                組織名（必須）
              </label>
              <input
                id="name"
                name="name"
                className="field"
                type="text"
                required
                maxLength={ORGANIZATION_NAME_MAX}
                placeholder="例：サロン名や屋号"
              />
              <span className="field-help">
                屋号（店名）でも会社名でもかまいません。法人成りしたり店舗が増えたりしても、名前を変えずに使えます。{ORGANIZATION_NAME_MAX}文字まで。同じ名前の組織は作れません。
              </span>
            </div>
            <button type="submit" className="btn btn-outline btn-block">
              組織を作成
            </button>
          </form>
        </Card>

        {!orgRes.error && orgs.length === 0 ? (
          <p className="muted center-text">まだ組織はありません。</p>
        ) : (
          <div className="stack-sm">
            {orgs.map((o) => {
              const salons = salonCount ? (salonCount.get(o.id) ?? 0) : null;
              const owners = ownerCount ? (ownerCount.get(o.id) ?? 0) : null;
              return (
                <Card key={o.id}>
                  <div className="stack-sm">
                    <h2 className="headline-sm">{o.name}</h2>
                    <dl className="admin-meta">
                      <div className="admin-meta-item">
                        <dt>作成日</dt>
                        <dd>{jstDate.format(new Date(o.created_at))}</dd>
                      </div>
                      <div className="admin-meta-item">
                        <dt>店舗数</dt>
                        <dd>{salons === null ? "—" : `${salons}店舗`}</dd>
                      </div>
                      <div className="admin-meta-item">
                        <dt>オーナー</dt>
                        <dd>{owners === null ? "—" : `${owners}名`}</dd>
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
