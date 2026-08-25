import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminApi } from "@/lib/admin-guard";

/**
 * POST /api/admin/invites/sent — 「送信済み」の手動チェック（echo Labs 運営者のみ）。
 *   入力: id（招待の uuid）／sent（"1" = 送信済みにする / それ以外 = 取り消す）
 *
 * メールは送らない。運営者が自分で送ったことを記録するだけの欄（要件）。
 * チェックボックスは JS 無しで動かすため、変更のたびに form を submit する
 * （onChange で submit する小さなクライアント部品を /admin/invites 側に置く）。
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

  const sent = String(form.get("sent") ?? "") === "1";

  const { error } = await supabaseAdmin
    .from("salon_invites")
    .update({ sent_at: sent ? new Date().toISOString() : null })
    .eq("id", id);

  if (error) {
    console.error("[admin/invites/sent] update failed:", error);
    return back("?error=save");
  }

  return back("");
}
