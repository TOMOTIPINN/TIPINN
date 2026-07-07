import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { sanitizeReturnTo } from "@/lib/return-to";

/**
 * POST /api/customer/name  — 顧客の表示名を確定/変更する（[[auth-method-line-b]]）
 *   form: name, returnTo?
 *
 * display_name を本人入力で上書きし、name_confirmed_at=now() を立てる（＝初回ゲートを抜ける）。
 * 以後の LINE ログイン callback は display_name を上書きしない（挿入時のみセット・別途対応）。
 *
 * 認可: セッション（echo_session）の customer_id にのみ作用（他人の名前は変更不可）。
 *   書き込みは service_role・サーバー側のみ（RLS deny-by-default は変更しない）。
 */
const NAME_MAX = 50;

function redirect(baseUrl: string, path: string) {
  return NextResponse.redirect(new URL(path, baseUrl), { status: 303 });
}

export async function POST(req: Request) {
  const baseUrl = process.env.APP_BASE_URL!;

  const form = await req.formData().catch(() => null);
  const rtRaw = form?.get("returnTo");
  const returnTo =
    typeof rtRaw === "string" && rtRaw ? sanitizeReturnTo(rtRaw) : "/mypage";

  const session = await getSession();
  // 未ログインなら名前画面に戻す（returnTo を保持）。
  if (!session) {
    const back = `/onboarding/name?returnTo=${encodeURIComponent(returnTo)}`;
    return redirect(
      baseUrl,
      `/api/auth/line/login?returnTo=${encodeURIComponent(back)}`,
    );
  }

  const nameRaw = form?.get("name");
  const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
  if (!name || name.length > NAME_MAX) {
    return redirect(
      baseUrl,
      `/onboarding/name?returnTo=${encodeURIComponent(returnTo)}&error=invalid`,
    );
  }

  const { error } = await supabaseAdmin
    .from("customers")
    .update({
      display_name: name,
      name_confirmed_at: new Date().toISOString(),
    })
    .eq("id", session.customer_id);

  if (error) {
    console.error("customer name update failed:", error);
    return redirect(
      baseUrl,
      `/onboarding/name?returnTo=${encodeURIComponent(returnTo)}&error=server`,
    );
  }

  return redirect(baseUrl, returnTo);
}
