import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";
import { jstPeriodStartISO } from "@/lib/staff-stats";
import { resolveSalonRole } from "@/lib/display-role";
import { getDashboardData } from "./dashboard-data";
import DashboardClient from "./DashboardClient";

/**
 * 数字管理ダッシュボード（画面マップ14系）— 店長(manager)専用の認証ガード。
 *
 * 認証（方式B / [[auth-method-line-b]]）: middleware は使わず server component でラップし、
 *   getStaffContext() で都度解決する。判定は /api/manager/* の requireManager()（manager-guard.ts）に
 *   厳密に合わせる：
 *   - 未ログイン（session なし）      → LINEログインへ（returnTo=/dashboard・401相当）
 *   - 非manager（ctx なし or role≠manager）→ /staff へ（requireManager が両者を 403 に畳むのに合わせ単一分岐・403相当）
 *   manager のみ DashboardClient（"use client" のモック画面）を描画する。
 *
 * ※ 中身のデータは DashboardClient 側のモックのまま（実データ化は本番タスク）。ここは認可のみ担う。
 */
export default async function DashboardPage() {
  const session = await getSession();
  if (!session) {
    redirect(`/api/auth/line/login?returnTo=${encodeURIComponent("/dashboard")}`);
  }

  const ctx = await getStaffContext();
  if (!ctx || ctx.role !== "manager") {
    redirect("/staff");
  }

  // 期間は「今月」固定（JST・月初〜現在）。引数は period_start/end を通す形（期間UIは後日配線）。
  const periodStart = jstPeriodStartISO("month");
  const periodEnd = new Date().toISOString();
  const data = await getDashboardData(ctx.salon_id, periodStart, periodEnd);
  const displayRole = await resolveSalonRole(ctx);

  return <DashboardClient data={data} role={displayRole} />;
}
