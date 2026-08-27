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
 *
 * 同時押下対策: sentinel で行を先に占有してから accounts.create を叩く。
 * 逆順にすると、競合に負けたリクエストが作った連結アカウントが Stripe 側に取り残される。
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
      // 占有を先に取る。書き込めた1本だけが accounts.create に進む。
      const sentinel = `pending_${ctx.salon_id}`;
      const { data: claimed } = await supabaseAdmin
        .from("salons")
        .update({ stripe_account_id: sentinel })
        .eq("id", ctx.salon_id)
        .is("stripe_account_id", null)
        .select("id");

      if (!claimed || claimed.length === 0) {
        // 負けた → Stripe を叩かずに DB の値を採用する。
        const { data: reload } = await supabaseAdmin
          .from("salons")
          .select("stripe_account_id")
          .eq("id", ctx.salon_id)
          .single();
        accountId = reload?.stripe_account_id ?? null;

        if (!accountId || accountId.startsWith("pending_")) {
          // 先行リクエストがまだ作成中。数秒後に押し直してもらう。
          return NextResponse.redirect(
            new URL("/dashboard?stripe=processing", baseUrl),
            { status: 303 }
          );
        }
      } else {
        try {
          // 冪等キーは salon_id 由来の固定値。万一すり抜けても同じアカウントが返る。
          const account = await stripe.accounts.create(
            { type: "standard" },
            { idempotencyKey: `salon_onboard_${ctx.salon_id}` }
          );
          accountId = account.id;

          await supabaseAdmin
            .from("salons")
            .update({
              stripe_account_id: accountId,
              stripe_connected_at: new Date().toISOString(),
            })
            .eq("id", ctx.salon_id)
            .eq("stripe_account_id", sentinel);
        } catch (err) {
          // 占有を解放しないと、このサロンは二度と連携できなくなる。
          await supabaseAdmin
            .from("salons")
            .update({ stripe_account_id: null })
            .eq("id", ctx.salon_id)
            .eq("stripe_account_id", sentinel);
          throw err;
        }
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
