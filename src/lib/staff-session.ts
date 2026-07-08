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

/**
 * line_user_id から在籍 staff 文脈を解決する（session cookie 非依存）。
 *
 * getStaffContext() はログイン後の session cookie を前提にするが、LINE callback は
 * まだ cookie を発行していない段階でロール別着地を決める必要がある（不具合 #2）。
 * そのため staff 解決ロジックをこの関数に単一ソース化し、両者から使う。
 * 退職者（archived_at 有り）はアクセス失効＝null（/staff・/manager に入れない）。
 */
export async function resolveStaffByLineUserId(
  lineUserId: string | null | undefined,
): Promise<StaffContext | null> {
  if (!lineUserId) return null;

  const { data } = await supabaseAdmin
    .from("staff")
    .select("id, salon_id, role, name")
    .eq("line_user_id", lineUserId)
    .is("archived_at", null)
    .maybeSingle();

  if (!data) return null;

  return {
    staff_id: data.id,
    salon_id: data.salon_id,
    role: data.role === "manager" ? "manager" : "staff",
    name: data.name,
  };
}

export async function getStaffContext(): Promise<StaffContext | null> {
  const session = await getSession();
  return resolveStaffByLineUserId(session?.line_user_id);
}
