import { NextResponse } from "next/server";
import { stripe, stripeOnboardingUrls } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireManager } from "@/lib/manager-guard";

/**
 * POST /api/manager/stripe/onboard — Stripe Connect Onboarding の開始（Phase 2・Account Links 方式）。
 *
 * - 連結アカウントが無ければ accounts.create({type:'standard'}) で作成し salons に保存（重複作成しない）。
 *   既にあればそれを再利用する。Direct Charge / application_fee=0（原則1・2）は購入側(checkout)で担保。
 * - accountLinks.create({type:'account_onboarding'}) で URL を生成して 303 リダイレクト。
 *   refresh_url / return_url は必ず渡す（数分で失効・リロード等で refresh に来るため）。
 *
 * 認可: requireManager（未ログイン401／非manager403）。salon_id はセッション由来（ctx）で越境不能（§12）。
 * OAuth 方式は使わない（新規プラットフォームに非推奨）。
 */
export const runtime = "nodejs"; // Stripe SDK は Node ランタイムで

export async function POST() {
  const gate = await requireManager();
  if (!gate.ok) return gate.res;
  const { ctx } = gate;

  const baseUrl = process.env.APP_BASE_URL!;

  try {
    // 既存の連結アカウントを確認（重複作成を避ける）。
    const { data: salon } = await supabaseAdmin
      .from("salons")
      .select("stripe_account_id")
      .eq("id", ctx.salon_id)
      .single();

    let accountId = salon?.stripe_account_id ?? null;

    if (!accountId) {
      // 新規作成 → 保存。stripe_connected_at は「連携を確立した時刻」として作成時に一度だけ刻む。
      const account = await stripe.accounts.create({ type: "standard" });
      accountId = account.id;

      // 競合ガード: stripe_account_id が null の行だけ更新（同時押下での二重作成を握り潰す）。
      const { data: updated } = await supabaseAdmin
        .from("salons")
        .update({
          stripe_account_id: accountId,
          stripe_connected_at: new Date().toISOString(),
        })
        .eq("id", ctx.salon_id)
        .is("stripe_account_id", null)
        .select("stripe_account_id");

      if (!updated || updated.length === 0) {
        // 別リクエストが先に保存済み → そちらを正とする（今作った account は使わない）。
        const { data: reload } = await supabaseAdmin
          .from("salons")
          .select("stripe_account_id")
          .eq("id", ctx.salon_id)
          .single();
        accountId = reload?.stripe_account_id ?? accountId;
      }
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      ...stripeOnboardingUrls(baseUrl),
    });

    // 303: POST → GET でオンボーディングURLへ。
    return NextResponse.redirect(link.url, { status: 303 });
  } catch (e) {
    console.error("[stripe-onboard] failed:", e);
    // 行き止まりにしない。ダッシュボードにエラー表示して再試行できるよう戻す。
    return NextResponse.redirect(new URL("/dashboard?stripe=error", baseUrl), {
      status: 303,
    });
  }
}
