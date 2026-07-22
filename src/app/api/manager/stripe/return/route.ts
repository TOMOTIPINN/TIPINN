import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireManager } from "@/lib/manager-guard";

/**
 * GET /api/manager/stripe/return — Account Links の return_url（Phase 2）。
 *
 * accounts.retrieve で details_submitted / charges_enabled / payouts_enabled を取得し salons に保存する。
 *   （webhook account.updated と同じ値を、戻ってきた瞬間にも同期して最新化する二重化。）
 * 未完了（charges_enabled=false）でも行き止まりにしない：ダッシュボードが状態に応じて
 *   「未連携／審査中」の再開導線を出すので、状態を保存してからダッシュボードへ戻す。
 *
 * 認可: requireManager。salon は ctx.salon_id にスコープ（越境不能・§12）。
 */
export const runtime = "nodejs";

export async function GET() {
  const gate = await requireManager();
  if (!gate.ok) return gate.res;
  const { ctx } = gate;

  const baseUrl = process.env.APP_BASE_URL!;

  try {
    const { data: salon } = await supabaseAdmin
      .from("salons")
      .select("stripe_account_id")
      .eq("id", ctx.salon_id)
      .single();

    const accountId = salon?.stripe_account_id ?? null;
    if (!accountId) {
      // アカウント未作成で戻ってきた（想定外）→ ダッシュボードへ（未連携表示）。
      return NextResponse.redirect(new URL("/dashboard", baseUrl));
    }

    const account = await stripe.accounts.retrieve(accountId);
    await supabaseAdmin
      .from("salons")
      .update({
        stripe_details_submitted: account.details_submitted ?? false,
        stripe_charges_enabled: account.charges_enabled ?? false,
        stripe_payouts_enabled: account.payouts_enabled ?? false,
      })
      .eq("id", ctx.salon_id);

    return NextResponse.redirect(new URL("/dashboard?stripe=updated", baseUrl));
  } catch (e) {
    console.error("[stripe-return] failed:", e);
    return NextResponse.redirect(new URL("/dashboard?stripe=error", baseUrl));
  }
}
