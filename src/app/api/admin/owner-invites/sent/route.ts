import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminApi } from "@/lib/admin-guard";

/**
 * POST /api/admin/owner-invites/sent — オーナー招待の「送信済み」の手動チェック（echo Labs 運営者のみ・§21 5d）。
 *   入力: id（招待の uuid）／sent（"1" = 送信済みにする / それ以外 = 取り消す）
 *
 * /api/admin/invites/sent（サロン招待）と同じ作り。更新するのは owner_invites の行だけ。
 * メールは送らない。運営者が自分で送ったことを記録するだけの欄。
 *
 * 認可: requireAdminApi（非運営者は 404）。ログには error.code だけを出す。
 */
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.res;

  const baseUrl = process.env.APP_BASE_URL!;
  const back = (qs: string) =>
    NextResponse.redirect(new URL(`/admin/owner-invites${qs}`, baseUrl), {
      status: 303,
    });

  const form = await req.formData().catch(() => null);
  if (!form) return back("?error=form");

  const id = String(form.get("id") ?? "");
  if (!UUID_RE.test(id)) return back("?error=id");

  // hidden の "0" と、チェック時は checkbox の "1" の両方が同名で届く（SentToggle）。
  // FormData.get は**最初の値**（常に "0"）を返すので使わない。getAll で "1" の有無を見る。
  const sent = form.getAll("sent").some((v) => v === "1");

  const { error } = await supabaseAdmin
    .from("owner_invites")
    .update({ sent_at: sent ? new Date().toISOString() : null })
    .eq("id", id);

  if (error) {
    console.error("[admin/owner-invites/sent] update failed:", {
      code: error.code,
    });
    return back("?error=save");
  }

  return back("");
}
