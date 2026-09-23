import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import type { StaffContext } from "@/lib/staff-session";
import type { SalonRole } from "@/components/RoleBar";

/**
 * 表示上のロール解決（RoleBar / data-role 用・[[auth-method-line-b]]）。
 *
 * staff.role は 'staff' | 'manager' の2値だが、UIでは「owner（= そのサロンを持つ組織の
 * オーナー）」を加えた3段で権限の濃さを示す（§12）。
 *
 * 判定（40_decisions.md §21「2026-09-23 決定」4）:
 * - role !== 'manager'                                        → 'staff'
 * - role === 'manager' かつ、ログイン中の line_user_id が
 *   そのサロンの salons.org_id の organization_members にある → 'owner'
 * - それ以外の manager                                        → 'manager'
 *
 * ★「そのサロンで created_at 最古の manager」という旧判定は廃止した（§21 コミット2）。★
 *   オーナーは「最初に登録された人」ではなく「その組織の経営主体」なので、
 *   migration 0048 で入れた organization_members が唯一の根拠になる。
 *
 * ★この戻り値は表示にしか使わない（認可・リダイレクト・データの絞り込みには使わない）。★
 *   全12箇所の呼び出し元は data-role / RoleBar / SalonNav のみ（2026-09-23 確認）。
 *   感想の可視範囲は ctx.role を直接見る（§21 コミット2a・staff/page.tsx）。
 *   そのため下の「失敗したら 'manager'」は**表示が1段控えめになるだけ**で、
 *   見える情報は増えも減りもしない。
 *
 * line_user_id は**サーバー側のセッション**から取る（クライアントからは受け取らない）。
 * PII（原則7）なのでログに出さない。PostgREST の error.message / details は
 * クエリ値を含み得るため、**error.code だけ**を出す（staff-session.ts と同じ方針）。
 *
 * 全クエリは service_role でサーバー側のみ。
 */
export async function resolveSalonRole(ctx: StaffContext): Promise<SalonRole> {
  if (ctx.role !== "manager") return "staff";

  // セッションが無い経路からは owner に昇格させない（呼び出し元は必ずログイン後だが、
  // ここだけ見ても安全なようにしておく）。
  const session = await getSession();
  const lineUserId = session?.line_user_id;
  if (!lineUserId) return "manager";

  // 1) そのサロンが属する組織。salons.org_id は 0048 で NOT NULL だが、
  //    引けなかった場合は安全側の 'manager'（バーは出るが owner 昇格はしない）。
  const { data: salon, error: salonError } = await supabaseAdmin
    .from("salons")
    .select("org_id")
    .eq("id", ctx.salon_id)
    .maybeSingle();

  const orgId = salon?.org_id as string | undefined;
  if (salonError || !orgId) {
    console.error("[display-role] salons.org_id を解決できませんでした", {
      code: salonError?.code,
    });
    return "manager";
  }

  // 2) その組織のオーナーか。organization_members は unique(line_user_id) なので
  //    (org_id, line_user_id) で高々1行（§21 決定3「1人1組織」）。
  const { data: member, error: memberError } = await supabaseAdmin
    .from("organization_members")
    .select("id")
    .eq("org_id", orgId)
    .eq("line_user_id", lineUserId)
    .maybeSingle();

  if (memberError) {
    console.error("[display-role] organization_members を引けませんでした", {
      code: memberError.code,
    });
    return "manager";
  }

  return member ? "owner" : "manager";
}
