import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminApi } from "@/lib/admin-guard";

/**
 * POST /api/admin/staff/transfer — スタッフの店舗移動（echo Labs 運営者のみ）。
 *   入力: staffId ＋ fromSalonId ＋ toSalonId（form-data）
 *   更新: staff{ salon_id = toSalonId, role = 'staff' }
 *
 * なぜ /admin なのか: 店舗移動は経営判断であり、各サロンの店長権限では扱わない。
 *   /manager/* は ctx.salon_id で自店にスコープされる構造（manager-guard.ts）なので、
 *   横断操作を持ち込むと権限モデルが崩れる。ここは env ADMIN_LINE_USER_IDS だけで判定する。
 *
 * 方式（行を移す）:
 *   ・line_user_id は触らない＝同じ行なので部分UNIQUE staff_line_user_id_active_uniq と衝突しない。
 *   ・reviews / rating_purchases は自前の salon_id を持つため、過去の実績は移動元に残る（移さない）。
 *   ・job_title は引き継ぐ（「店長」のままでも通す。移動先の編集画面から直せる）。
 *   ・role は必ず 'staff' にリセットする＝意図しない権限付与を防ぐ。
 *   ・写真は salon-assets/staff/<staff_id>/photo で salon_id を含まないため移動不要。
 *
 * 楽観ロック: WHERE に fromSalonId を含める。画面表示後に別経路で動いていたら0件更新 → conflict。
 * 認可: requireAdminApi（非運営者・未ログイン・env未設定はすべて **404**。403 は返さない）。
 * 応答: フォーム送信 → /admin/staff?...&moved=1 / ?error=<reason> へ 303。
 */
export const runtime = "nodejs";

/** 移動の拒否理由 → クエリに載せる分類語（画面側が日本語にする）。 */
type Reason =
  | "form"
  | "id"
  | "same_salon"
  | "not_found"
  | "last_manager"
  | "conflict"
  | "save";

export async function POST(req: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.res;

  const baseUrl = process.env.APP_BASE_URL!;
  /** 選択中のサロンを保ったまま戻す（移動後は移動元を見せ続ける＝結果が見える）。 */
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
  const fromSalonId = str("fromSalonId");
  const toSalonId = str("toSalonId");

  const fail = (reason: Reason) =>
    back(fromSalonId, `error=${reason}`);

  if (!staffId || !fromSalonId || !toSalonId) return fail("id");
  if (fromSalonId === toSalonId) return fail("same_salon");

  // 対象の現在値を取得（移動元スコープ＋在籍のみ）。退職者は移動しない
  // ＝部分UNIQUE の対象（archived_at is null）を明示的に揃える。
  const { data: target, error: targetErr } = await supabaseAdmin
    .from("staff")
    .select("id, role, line_user_id")
    .eq("id", staffId)
    .eq("salon_id", fromSalonId)
    .is("archived_at", null)
    .maybeSingle();

  if (targetErr) {
    console.error("[admin/staff] transfer target lookup failed:", targetErr);
    return fail("save");
  }
  if (!target) return fail("not_found");

  // 移動元に manager が1人しか居ない状態でその人を動かすと、旧サロンは
  // /manager に入れる人が誰も居なくなる（requireManager は role==='manager' のみ通す）。
  // SQL 直打ちでしか復旧できない事故なので、UPDATE の前に弾く。
  if (target.role === "manager") {
    const { data: managers, error: mgrErr } = await supabaseAdmin
      .from("staff")
      .select("id")
      .eq("salon_id", fromSalonId)
      .eq("role", "manager")
      .is("archived_at", null);

    if (mgrErr) {
      console.error("[admin/staff] transfer manager count failed:", mgrErr);
      return fail("save");
    }
    if ((managers ?? []).length <= 1) return fail("last_manager");
  }

  // 楽観ロック: salon_id が表示時のまま（fromSalonId）の行だけ動かす。
  const { data: updated, error } = await supabaseAdmin
    .from("staff")
    .update({ salon_id: toSalonId, role: "staff" })
    .eq("id", staffId)
    .eq("salon_id", fromSalonId)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[admin/staff] transfer update failed:", error);
    return fail("save");
  }
  // 0件更新＝表示後に別経路で動いた（or 退職した）。上書きせず conflict で戻す。
  if (!updated) return fail("conflict");

  // 追跡用（audit_log は作らない方針・正式な監査要件が出たときにまとめて設計する）。
  // ★ 運営者の line_user_id・スタッフ名・LINE表示名・invite_token は出さない（原則7）。UUID のみ。
  console.info("[admin/staff] transfer", {
    action: "staff.transfer",
    target_staff_id: staffId,
    from_salon_id: fromSalonId,
    to_salon_id: toSalonId,
    from_role: target.role,
  });

  return back(fromSalonId, "moved=1");
}
