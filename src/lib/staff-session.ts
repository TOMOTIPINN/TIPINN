import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * スタッフ文脈の解決（認証方式B / LINEログイン統一・[[auth-method-line-b]]）。
 *
 * echo ではセッションは1種類（@/lib/session の echo_session ＝ customer_id / line_user_id）。
 * 「スタッフかどうか」は別ログインではなく、ログイン中の line_user_id に紐付く staff 行が
 * あるかで都度解決する（JWTには焼かない＝後から紐付け／role変更があっても常に最新）。
 *
 * - 顧客のみ（staff未紐付け）の人 → null
 * - staff に紐付く人 → その staff_id / salon_id / role / name
 *
 * 全クエリは service_role でサーバー側のみ。line_user_id は PII（原則7）。
 */
export type StaffRole = "staff" | "manager";

export type StaffContext = {
  staff_id: string;
  salon_id: string;
  role: StaffRole;
  name: string;
};

export async function getStaffContext(): Promise<StaffContext | null> {
  const session = await getSession();
  if (!session?.line_user_id) return null;

  const { data } = await supabaseAdmin
    .from("staff")
    .select("id, salon_id, role, name")
    .eq("line_user_id", session.line_user_id)
    .maybeSingle();

  if (!data) return null;

  return {
    staff_id: data.id,
    salon_id: data.salon_id,
    role: data.role === "manager" ? "manager" : "staff",
    name: data.name,
  };
}
