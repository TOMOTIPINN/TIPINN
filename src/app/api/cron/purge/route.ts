import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * GET /api/cron/purge — login_attempts の保存期間ワーカー（migration 0038 の呼び出し側）。
 *
 * Vercel cron（vercel.json・1日1回 JST 3:00 = UTC 18:00）が叩く。**呼び出し元は Vercel cron のみ**
 * （画面・スタッフ導線からは一切呼ばない）。やることは `purge_old_login_attempts()`（0038）を
 * 1回呼ぶだけ＝30日より古い認証試行ログを削除する。
 *   ・**保存期間「30日」は SQL 側（0038）にしか持たない。** ここで日数を再計算すると、
 *     関数を直したときに片方だけ古い定義が残る（CLAUDE.md「導出ロジックを二重化しない」）。
 *     削除件数は「呼ぶ前後の総件数の差」として観測する＝日数の定義に触れずに済む。
 *   ・件数取得はあくまで観測用。失敗しても purge 自体は成功扱いにし、deleted は null で返す。
 *   ・0038 の revoke で service_role の EXECUTE も外れていたため、0040 で grant 済み
 *     （未適用だと rpc が 42501 permission denied for function で落ちる）。
 *
 * 認可: Vercel cron は CRON_SECRET を Authorization: Bearer で付与する。一致しなければ 401。
 * 書き込みは supabaseAdmin・サーバー側のみ（RLS deny-by-default）。
 */
export const runtime = "nodejs";

export async function GET(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[purge] missing CRON_SECRET");
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const before = await countLoginAttempts();

  const { error } = await supabaseAdmin.rpc("purge_old_login_attempts");
  if (error) {
    console.error("[purge] purge_old_login_attempts failed:", error);
    return NextResponse.json({ error: "purge_failed" }, { status: 500 });
  }

  const after = await countLoginAttempts();
  const deleted = before !== null && after !== null ? before - after : null;

  return NextResponse.json({ ok: true, before, after, deleted });
}

/**
 * login_attempts の総件数（観測用）。取れなければ null を返して呼び出し側を止めない
 * （削除は済んでいるのに 500 を返して cron を失敗扱いにしないため）。
 */
async function countLoginAttempts(): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from("login_attempts")
    .select("id", { count: "exact", head: true });

  if (error) {
    console.error("[purge] count failed:", error);
    return null;
  }
  return count ?? null;
}
