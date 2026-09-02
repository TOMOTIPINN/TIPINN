import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminApi } from "@/lib/admin-guard";

/**
 * POST /api/admin/staff/role — スタッフの権限(role)変更（echo Labs 運営者のみ）。
 *   入力: staffId ＋ salonId ＋ role（'manager' | 'staff'。form-data）
 *   更新: staff{ role }
 *
 * なぜ必要か: 作成時（api/manager/staff・api/manager/salon/new）以外に role を書く経路が
 *   コード上に存在しない（/manager/staff/[id] の編集は job_title のみで role に触らない）。
 *   そのため「移動で staff に落とした人を移動先で manager にする」「唯一の manager を
 *   移動させる前に別の人を manager にする」が SQL 直打ちでしか出来なかった。店舗移動と対で要る。
 *
 * ★ job_title（職種）とは別物★ job_title は表示用の肩書きで権限を持たない
 *   （api/manager/staff/update/route.ts の注記と同じ切り分け）。ここでは job_title に触らない。
 *
 * 認可: requireAdminApi（非運営者・未ログイン・env未設定はすべて **404**）。
 * 応答: フォーム送信 → /admin/staff?...&rolechanged=1 / ?error=<reason> へ 303。
 */
export const runtime = "nodejs";

type Reason =
  | "form"
  | "id"
  | "invalid_role"
  | "not_found"
  | "no_change"
  | "last_manager"
  | "conflict"
  | "save";

/** role の値域。staff.role は 'staff' | 'manager' の2値（lib/staff-session.ts の StaffRole と一致）。 */
const ROLES = ["staff", "manager"] as const;
type Role = (typeof ROLES)[number];

export async function POST(req: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.res;

  const baseUrl = process.env.APP_BASE_URL!;
  const back = (salonId: string, qs: string) =>
    NextResponse.redirect(
      new URL(
        `/admin/staff?salon=${encodeURIComponent(salonId)}&${qs}`,
        baseUrl,
      ),
      { status: 303 },
    );

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.redirect(new URL("/admin/staff?error=form", baseUrl), {
      status: 303,
    });
  }

  const str = (k: string): string => {
    const v = form.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  const staffId = str("staffId");
  const salonId = str("salonId");
  const roleRaw = str("role");

  const fail = (reason: Reason) => back(salonId, `error=${reason}`);

  if (!staffId || !salonId) return fail("id");
  // ホワイトリスト検証（api/manager/staff/route.ts と同じ作法。既定へのフォールバックはしない
  // ＝権限の変更なので、不正値は黙って staff に倒さず明示的に弾く）。
  if (!ROLES.includes(roleRaw as Role)) return fail("invalid_role");
  const role = roleRaw as Role;

  const { data: target, error: targetErr } = await supabaseAdmin
    .from("staff")
    .select("id, role")
    .eq("id", staffId)
    .eq("salon_id", salonId)
    .is("archived_at", null)
    .maybeSingle();

  if (targetErr) {
    console.error("[admin/staff] role target lookup failed:", targetErr);
    return fail("save");
  }
  if (!target) return fail("not_found");
  // 現在値と同じなら 0件更新と区別が付かないので先に弾く（conflict と誤表示しない）。
  if (target.role === role) return fail("no_change");

  // manager → staff に落とすときだけ、最後の1人かを見る（上げる側は無条件で許可）。
  // 理由は transfer 側の last_manager と同じ: サロンが管理不能になると SQL でしか戻せない。
  if (target.role === "manager" && role === "staff") {
    const { data: managers, error: mgrErr } = await supabaseAdmin
      .from("staff")
      .select("id")
      .eq("salon_id", salonId)
      .eq("role", "manager")
      .is("archived_at", null);

    if (mgrErr) {
      console.error("[admin/staff] role manager count failed:", mgrErr);
      return fail("save");
    }
    if ((managers ?? []).length <= 1) return fail("last_manager");
  }

  // 楽観ロック: 表示時の role のままの行だけ更新する（読んでから書くまでの間の変更を上書きしない）。
  const { data: updated, error } = await supabaseAdmin
    .from("staff")
    .update({ role })
    .eq("id", staffId)
    .eq("salon_id", salonId)
    .eq("role", target.role)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[admin/staff] role update failed:", error);
    return fail("save");
  }
  if (!updated) return fail("conflict");

  // ★ 運営者の line_user_id・スタッフ名・LINE表示名は出さない（原則7）。UUID と role のみ。
  console.info("[admin/staff] role", {
    action: "staff.role",
    target_staff_id: staffId,
    salon_id: salonId,
    from_role: target.role,
    to_role: role,
  });

  return back(salonId, "rolechanged=1");
}
