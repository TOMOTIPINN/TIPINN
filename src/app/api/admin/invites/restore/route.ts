import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminApi } from "@/lib/admin-guard";
import { inviteExpiryISO } from "@/lib/salon-invite";

/**
 * POST /api/admin/invites/restore — 期限切れ招待の「復旧」（echo Labs 運営者のみ）。
 *   入力: id（招待の uuid）
 *   処理: expires_at を now+14日 に延長する。**コードは変えない**＝同じコードが復活する
 *         （既にメールで送ったコードを送り直さずに済ませるための機能）。
 *
 * ★使用済み（used_at is not null）は復旧しない★
 *   WHERE に used_at is null を必ず入れる。これが無いと、既にサロンを作った招待を
 *   もう一度使える状態に戻せてしまい「1招待＝1サロン」が壊れる。
 *   （uq_salon_invites_salon_id があるので2件目の消費は DB でも弾かれるが、
 *     アプリ側でも塞いで二重に守る。）
 *
 * 認可: requireAdminApi（非運営者は 404）。
 */
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.res;

  const baseUrl = process.env.APP_BASE_URL!;
  const back = (qs: string) =>
    NextResponse.redirect(new URL(`/admin/invites${qs}`, baseUrl), {
      status: 303,
    });

  const form = await req.formData().catch(() => null);
  if (!form) return back("?error=form");

  const id = String(form.get("id") ?? "");
  if (!UUID_RE.test(id)) return back("?error=id");

  const { data, error } = await supabaseAdmin
    .from("salon_invites")
    .update({ expires_at: inviteExpiryISO() })
    .eq("id", id)
    .is("used_at", null) // 使用済みは復旧しない
    .select("id");

  if (error) {
    console.error("[admin/invites/restore] update failed:", error);
    return back("?error=save");
  }
  // 0件 = 使用済み（または存在しない）。画面に理由を出す。
  if (!data || data.length === 0) return back("?error=restore_used");

  return back("?restored=1");
}
