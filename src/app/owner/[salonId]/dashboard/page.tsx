import { requireOwnerSalon } from "@/lib/owner-guard";
import { getDashboardData } from "@/app/dashboard/dashboard-data";
import { resolvePeriod } from "@/app/dashboard/period";
import { parseRecentTake } from "@/app/dashboard/recent";
import DashboardClient from "@/app/dashboard/DashboardClient";
import OwnerSalonNav from "@/app/owner/OwnerSalonNav";

/**
 * オーナーが見る、1店舗ぶんのダッシュボード（/owner/[salonId]/dashboard・§21 コミット3b）。
 *
 * ★「店舗を切り替えて、既存の店長画面と同じものを見る」（§21 決定1）★
 *   `getDashboardData` を **salonId 引数版としてそのまま流用**する。
 *   ⚠️ **複数店舗に広げてはいけない**（§21 設計上の要点）。`dashboard-data.ts` は
 *   `staffNames` を**名前文字列でキーにしている**ため、別店舗に同名スタッフがいると
 *   集計が合流して壊れる。「1サロンぶんを何度も呼ぶ」形を崩さない。
 *
 * 認可: `requireOwnerSalon()`。未ログイン→LINEログイン／非オーナー→/staff／
 *   **自分の組織配下でない salonId → 404**（他組織の店舗の存在確認に使わせない）。
 *   salonId はパスに入っていてもクライアント入力なので、照合は DB 由来の
 *   `ctx.salons` に対して行う（`50_security.md` §1.1）。
 *
 * 顧客名（最近の評価・VIP のお客様）は**店長画面と同じく出す**（2026-09-23 決定。
 * オーナーが店長と同じ情報を持つため）。ただし**注記の文言だけ差し替える**：
 * オーナーはレジに立たないので「レジでの判別補助」は当てはまらない。
 * 書くのは「誰が見られるか」（原則7）。
 *
 * ★/manager/* ・ /staff/* への導線を出さない★
 *   - `SalonNav`（数字管理/感想/スタッフ/来店受付＋設定5件）は描画せず、`nav` に
 *     `OwnerSalonNav`（RoleBar ＋ 数字/感想の行き来 ＋ 店舗一覧へ戻る）を渡す。
 *   - Stripe 連携カードは `/api/manager/stripe/onboard` へ form POST するため
 *     `stripeStatus={null}` で**出さない**（店舗の設定は各店長が `/manager` で行う・§8.1）。
 *   - 期間切替と「もっと見る」の遷移先は `basePath` でこのページ自身に向ける。
 *
 * 集計期間は `/dashboard` と同じく URL 由来（`?period=` / `?from=` / `?to=`）で、
 * 「最近の評価」の深さも `?take=`（§20 決定4）。resolvePeriod / parseRecentTake を共有する。
 */
export const dynamic = "force-dynamic";

export default async function OwnerSalonDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ salonId: string }>;
  searchParams: Promise<{
    period?: string;
    from?: string;
    to?: string;
    take?: string;
  }>;
}) {
  const { salonId } = await params;
  // 期間切替・「もっと見る」・ログイン後の戻り先は、すべてこのページ自身。
  const basePath = `/owner/${salonId}/dashboard`;

  const { salon } = await requireOwnerSalon(salonId, basePath);

  const sp = await searchParams;
  const period = resolvePeriod(sp);
  const recentTake = parseRecentTake(sp.take);

  const data = await getDashboardData(
    salon.id,
    period.periodStart,
    period.periodEnd,
    period.label,
    recentTake,
  );

  return (
    <DashboardClient
      data={data}
      role="owner"
      period={{ key: period.key, from: period.from, to: period.to }}
      recentTake={recentTake}
      stripeStatus={null}
      basePath={basePath}
      customerNameNote="※顧客名は、この店舗の店長とオーナーだけが見られます（原則7）。"
      nav={<OwnerSalonNav salonId={salon.id} active="dashboard" />}
    />
  );
}
