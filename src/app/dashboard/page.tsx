import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";
import { resolveSalonRole } from "@/lib/display-role";
import { getDashboardData } from "./dashboard-data";
import { resolvePeriod } from "./period";
import DashboardClient from "./DashboardClient";

/**
 * 数字管理ダッシュボード（画面マップ14系）— 店長(manager)専用の認証ガード。
 *
 * 認証（方式B / [[auth-method-line-b]]）: middleware は使わず server component でラップし、
 *   getStaffContext() で都度解決する。判定は /api/manager/* の requireManager()（manager-guard.ts）に
 *   厳密に合わせる：
 *   - 未ログイン（session なし）      → LINEログインへ（returnTo=/dashboard・401相当）
 *   - 非manager（ctx なし or role≠manager）→ /staff へ（requireManager が両者を 403 に畳むのに合わせ単一分岐・403相当）
 *   manager のみ DashboardClient を描画する（"use client" の表示専用）。
 *
 * ※ 中身のデータは実データ（dashboard-data.ts が salon_id スコープで集計）を描画する。ここは認可のみ担う。
 *
 * 集計期間は URL の searchParams（?period= / ?from= / ?to=）で決まる（resolvePeriod が唯一の正）。
 *   同じ URL は同じ期間を再現する（custom＝暦区間で確定・賞与査定の再現性）。不正・欠落は「今月」。
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect(`/api/auth/line/login?returnTo=${encodeURIComponent("/dashboard")}`);
  }

  const ctx = await getStaffContext();
  if (!ctx || ctx.role !== "manager") {
    redirect("/staff");
  }

  // 集計期間は URL 由来（相対プリセット＋暦区間の custom）。periodStart/End/label を一括で解決。
  const params = await searchParams;
  const period = resolvePeriod(params);
  const data = await getDashboardData(
    ctx.salon_id,
    period.periodStart,
    period.periodEnd,
    period.label,
  );
  const displayRole = await resolveSalonRole(ctx);

  return (
    <DashboardClient
      data={data}
      role={displayRole}
      period={{ key: period.key, from: period.from, to: period.to }}
    />
  );
}
