import { supabaseAdmin } from "@/lib/supabase-admin";
import type { StaffContext } from "@/lib/staff-session";
import type { SalonRole } from "@/components/RoleBar";

/**
 * 表示上のロール解決（RoleBar / data-role 用・[[auth-method-line-b]]）。
 *
 * staff.role は 'staff' | 'manager' の2値だが、UIでは「owner（=そのサロンの最初の manager）」を
 * 加えた3段で権限の濃さを示す（§12・DBカラムは追加しない方針）。
 *
 * 判定:
 * - role !== 'manager'            → 'staff'
 * - role === 'manager' かつ そのサロンで created_at 最古の manager.staff_id と一致 → 'owner'
 * - それ以外の manager           → 'manager'
 *
 * 「最初の manager＝owner」はサロン新規作成時に作成者が最初の manager として登録される導線
 * （api/manager/salon/new）に対応する。全クエリは service_role でサーバー側のみ。
 */
export async function resolveSalonRole(ctx: StaffContext): Promise<SalonRole> {
  if (ctx.role !== "manager") return "staff";

  const { data } = await supabaseAdmin
    .from("staff")
    .select("id")
    .eq("salon_id", ctx.salon_id)
    .eq("role", "manager")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  // 万一 owner が引けない場合は安全側で 'manager'（バーは出るが owner 昇格はしない）。
  return data?.id === ctx.staff_id ? "owner" : "manager";
}
