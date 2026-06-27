import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { resolveInvite } from "@/lib/staff-invite";

/**
 * POST /api/staff/bind  （認証方式B / [[auth-method-line-b]]）
 * 招待トークンを消費して、ログイン中の line_user_id を staff 行に紐付ける（権威の処理）。
 *   form: token=<invite_token>
 *
 * 紐付けは「新しい ID/PW を作らない」前提：本人は LINE ログイン済み（=セッションの line_user_id）。
 * 書き込みは service_role・サーバー側のみ（RLS deny-by-default は変更しない）。
 *
 * 成功 → /staff へ 303 リダイレクト。失敗 → /staff/join?token=…&error=理由 へ戻す。
 */
function redirect(baseUrl: string, path: string) {
  return NextResponse.redirect(new URL(path, baseUrl), { status: 303 });
}

export async function POST(req: Request) {
  const baseUrl = process.env.APP_BASE_URL!;

  const session = await getSession();
  // 未ログインなら、戻り先を join に固定して LINE ログインへ。
  const form = await req.formData().catch(() => null);
  const token = (form?.get("token") as string | null) ?? null;

  if (!session?.line_user_id) {
    const back = `/staff/join${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    return redirect(
      baseUrl,
      `/api/auth/line/login?returnTo=${encodeURIComponent(back)}`,
    );
  }

  const result = await resolveInvite(token, session.line_user_id);
  if (!result.ok) {
    const q = token ? `?token=${encodeURIComponent(token)}&` : "?";
    return redirect(baseUrl, `/staff/join${q}error=${result.reason}`);
  }

  // 競合ガード: invite_token 一致かつ未紐付けの行のみ更新（同時実行の二重紐付け防止）。
  const { data: updated, error } = await supabaseAdmin
    .from("staff")
    .update({
      line_user_id: session.line_user_id,
      bound_at: new Date().toISOString(),
      invite_token: null,
      invite_expires_at: null,
    })
    .eq("invite_token", token!)
    .is("line_user_id", null)
    .select("id")
    .maybeSingle();

  if (error || !updated) {
    console.error("staff bind failed:", error);
    const q = token ? `?token=${encodeURIComponent(token)}&` : "?";
    return redirect(baseUrl, `/staff/join${q}error=not_found`);
  }

  return redirect(baseUrl, "/staff");
}
