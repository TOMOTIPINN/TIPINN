import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getStaffContext, type StaffContext } from "@/lib/staff-session";

/**
 * 店長(manager)専用 API のガード（認証方式B / [[auth-method-line-b]]）。
 * /api/manager/* で共通：未ログイン→401／スタッフ未紐付け・非manager→403。
 * 成功時は解決済み StaffContext（salon_id でスコープに使う）を返す。
 */
export async function requireManager(): Promise<
  { ok: true; ctx: StaffContext } | { ok: false; res: NextResponse }
> {
  const session = await getSession();
  if (!session) {
    return {
      ok: false,
      res: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  const ctx = await getStaffContext();
  if (!ctx || ctx.role !== "manager") {
    return {
      ok: false,
      res: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }
  return { ok: true, ctx };
}
