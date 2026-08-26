import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/admin-guard";
import { Eyebrow, Card } from "@/components/ui";
import {
  getAdminSalonStats,
  WINDOW_DAYS,
  type AdminSalonRow,
} from "@/lib/admin-salon-stats";

/**
 * サロン稼働状況（/admin/salons・echo Labs 運営者のみ）。
 *
 * ★非運営者には notFound() ＝ HTTP 404★
 *   /admin/invites と同じ作法（@/lib/admin-guard・env ADMIN_LINE_USER_IDS だけで判定）。
 *   403 は「このURLは存在する」というオラクルになるため使わない。staff.role は見ない。
 *   導線は張らない（URL直打ち専用）。ナビに出すと運営画面の存在が漏れる。
 *
 * 読者は echo Labs の運営者であってサロンオーナーではない。目的は6店舗の同時稼働で
 * 「どの店がどこで詰まっているか」を1画面で掴み、コンサルの当たりを付けること。
 * 集計そのものは @/lib/admin-salon-stats（直近30日固定・期間切替なし）。
 *
 * ★スタッフ別の内訳は出さない★
 *   集計層で staff_id を引いていないので、この画面には出しようがない。
 *   docs/00_philosophy.md §4.1（スコア化・ランキングしない）／§4.5（格差を可視化しない）。
 *
 * 配色（docs/30_design.md §2）:
 *   ・赤は使わない。
 *   ・率が低いサロンを警告色で強調しない。数値を並べるだけにする＝「詰まり」の判断は人がやる。
 *     しきい値で色を付けると、その色が独り歩きしてサロンの格付けになる（§4.5 と同じ理由で避ける）。
 *   ・mint は「好調・上昇」の差し色としてのみ使ってよいが、ここでは順位付けを避けるため使わない。
 *   ・インライン style 禁止（globals.css の .admin-stat* トークンのみ）。
 */
export const dynamic = "force-dynamic";

/** 率の表示（0除算は「—」）。小数は出さない＝運営が見るのは桁感であって精度ではない。 */
function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

/** 金額（税込・円）。店舗合計のみ。 */
function yen(v: number): string {
  return `¥${v.toLocaleString("ja-JP")}`;
}

/** JST の日付表示（YYYY/MM/DD）。/admin/invites と同じ Asia/Tokyo 基準。 */
function fmtDate(isoDate: string): string {
  return isoDate.replaceAll("-", "/");
}

function SalonRowCells({ row }: { row: AdminSalonRow }) {
  return (
    <tr>
      <th scope="row" className="admin-stat-name">
        {row.salonName}
      </th>
      <td>{row.staffCount}</td>
      <td>{row.newCustomers}</td>
      <td>{row.sent}</td>
      <td>
        {row.skipped}
        {row.skipBreakdown.length > 0 && (
          <span className="admin-stat-sub">
            {row.skipBreakdown.map((b) => `${b.label} ${b.count}`).join(" / ")}
          </span>
        )}
      </td>
      <td>{row.reviews}</td>
      <td>{pct(row.reviewRate)}</td>
      <td>{row.purchases}</td>
      <td>{pct(row.purchaseRate)}</td>
      <td>{yen(row.amount)}</td>
    </tr>
  );
}

export default async function AdminSalonsPage() {
  // 非運営者はここで 404。以降の DB アクセスには絶対に到達させない（/admin/invites と同型）。
  if (!(await isAdmin())) notFound();

  const { rows, periodStartDate, todayDate } = await getAdminSalonStats();

  const total = rows.reduce(
    (acc, r) => ({
      staffCount: acc.staffCount + r.staffCount,
      newCustomers: acc.newCustomers + r.newCustomers,
      sent: acc.sent + r.sent,
      skipped: acc.skipped + r.skipped,
      reviews: acc.reviews + r.reviews,
      purchases: acc.purchases + r.purchases,
      amount: acc.amount + r.amount,
    }),
    {
      staffCount: 0,
      newCustomers: 0,
      sent: 0,
      skipped: 0,
      reviews: 0,
      purchases: 0,
      amount: 0,
    },
  );

  return (
    <main className="page page-top">
      <div className="container container-wide stack animate-in">
        <header className="stack-sm">
          <Eyebrow>Admin</Eyebrow>
          <h1 className="headline">サロン稼働状況</h1>
          <p className="muted">
            直近{WINDOW_DAYS}日（{fmtDate(periodStartDate)} 〜 {fmtDate(todayDate)}
            ・JST）。テストサロンとデモサロン、デモ顧客は集計から除いています。
          </p>
        </header>

        {rows.length === 0 ? (
          <p className="muted center-text">対象のサロンがありません。</p>
        ) : (
          <Card>
            <div className="admin-stat-scroll">
              <table className="admin-stat-table">
                <thead>
                  <tr>
                    <th scope="col">サロン</th>
                    <th scope="col">在籍</th>
                    <th scope="col">新規客</th>
                    <th scope="col">通知</th>
                    <th scope="col">未送信</th>
                    <th scope="col">感想</th>
                    <th scope="col">感想率</th>
                    <th scope="col">有料</th>
                    <th scope="col">有料率</th>
                    <th scope="col">金額</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <SalonRowCells key={r.salonId} row={r} />
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" className="admin-stat-name">
                      合計
                    </th>
                    <td>{total.staffCount}</td>
                    <td>{total.newCustomers}</td>
                    <td>{total.sent}</td>
                    <td>{total.skipped}</td>
                    <td>{total.reviews}</td>
                    <td>{pct(total.sent > 0 ? total.reviews / total.sent : null)}</td>
                    <td>{total.purchases}</td>
                    <td>
                      {pct(total.sent > 0 ? total.purchases / total.sent : null)}
                    </td>
                    <td>{yen(total.amount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        )}

        <p className="note-fine">
          在籍は現在の人数（退職者を除く）で、期間に連動しません。新規客は「そのサロンでの初回来店」が
          期間内にある顧客の数です（顧客アカウント数ではありません）。感想率・有料率の分母はどちらも通知の
          送信数です。未送信は送信予定を取りやめた件数で、内訳は取りやめた理由です。
        </p>
        <p className="note-fine">
          スタッフ別の内訳は意図的に出していません（docs/00_philosophy.md
          §4.1・§4.5）。数字は判断材料であって、サロンやスタッフの格付けではありません。
        </p>
      </div>
    </main>
  );
}
