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

  const { data, error } = await supabaseAdmin
    .from("staff")
    .select("id, salon_id, role, name")
    .eq("line_user_id", lineUserId)
    .is("archived_at", null)
    .maybeSingle();

  // maybeSingle は複数行ヒットで error=PGRST116 / data=null を返す（postgrest-js）。
  // ここを黙って null にすると「スタッフ未登録」と同じ扱いになり、本人が /staff・/manager から
  // 締め出されたまま痕跡が残らない。**挙動は変えず**（従来どおり null）、気づけるようにログだけ出す。
  // ★ line_user_id は PII（原則7）＝出さない。error.message/details も PostgREST 由来だと
  //   クエリ値を含み得るため、PGRST116（postgrest-js がローカル生成・行数のみ）の details だけ載せる。
  if (error) {
    console.error("[staff-session] resolveStaffByLineUserId failed", {
      code: error.code,
      ...(error.code === "PGRST116" ? { details: error.details } : {}),
    });
  }

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

/**
 * その LINE に **staff 行があるか**（退職済みも含む）。サロン作成の入口チェック用
 * （§21 コミット4a・40_decisions.md §21 決定6）。
 *
 * ★`resolveStaffByLineUserId` ではこの判定はできない★
 *   あちらは `archived_at is null`（在籍のみ）で絞るため、**退職済みの行だけを持つ人**を
 *   「staff 行なし」と答えてしまう。しかし本番の `uq_staff_line_user_id` は
 *   **archived 条件を持たない**部分 unique index（`60_incidents.md` 2026-09-02 の★訂正★）なので、
 *   退職済みの行があるだけで `staff` の INSERT は必ず unique 違反で落ちる。
 *   入口で弾けないと、`salons` を作ってからロールバックする経路に戻ってしまう。
 *   よってここは **`archived_at` で絞らない**。
 *
 * ★fail closed★ 引けなかったとき・件数が読めなかったときは **true（＝作らせない）** を返す。
 *   ここで false を返すと、確認できないまま `salons` INSERT まで進んでしまう。
 *
 * `maybeSingle` は使わない（複数行ヒットで data=null になり「行なし」と区別できない）。
 * count だけを引き、行の中身は取らない。line_user_id は PII（原則7）なのでログに出さない。
 */
export async function hasAnyStaffRow(
  lineUserId: string | null | undefined,
): Promise<boolean> {
  // 呼び出し側は session を確認済みの想定。万一 id が無ければ確認できない＝弾く。
  if (!lineUserId) return true;

  const { count, error } = await supabaseAdmin
    .from("staff")
    .select("id", { count: "exact", head: true })
    .eq("line_user_id", lineUserId);

  if (error) {
    console.error("[staff-session] hasAnyStaffRow failed", { code: error.code });
    return true;
  }
  if (count === null) {
    console.error("[staff-session] hasAnyStaffRow: count を取得できませんでした");
    return true;
  }
  return count > 0;
}
