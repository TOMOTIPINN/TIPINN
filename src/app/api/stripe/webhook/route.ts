import { NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getTier } from "@/lib/rating-tiers";

/**
 * POST /api/stripe/webhook — 評価スタンプ購入の記録（フェーズ4.2）。
 *
 * ★Direct Charge なので checkout.session.completed は **Connect イベント**として届く
 *   （event.account に連結アカウントIDが入る）。署名検証には **Connect エンドポイント専用**の
 *   署名シークレット STRIPE_CONNECT_WEBHOOK_SECRET を使う。
 *
 * やること: session.metadata を読み rating_purchases に INSERT するだけ。
 *   - 冪等: stripe_payment_id(= payment_intent) の unique で二重記録を防ぐ（ON CONFLICT DO NOTHING）。
 *   - 価格はサーバーの tier 定義のみ信用（原則8）。
 *   - 記録のみ。賞与・残高ロジックは一切入れない（原則5・6）。echo は資金を持たない（原則1）。
 */
export const runtime = "nodejs"; // Stripe SDK / 署名検証は Node ランタイムで

export async function POST(req: Request) {
  // 生body（request.text()）で署名検証する。JSONパースより前に読むこと。
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;

  if (!sig || !secret) {
    console.error("[stripe-webhook] missing signature or secret");
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (e) {
    console.error("[stripe-webhook] signature verification failed:", e);
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    // 対象外イベントは確認応答のみ（Stripeの再送を止める）
    return NextResponse.json({ received: true });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  // Direct Charge: 連結アカウント上のイベント。account に連結アカウントIDが入る（ログ用）。
  const connectedAccount = event.account ?? "(none)";

  try {
    const outcome = await recordRatingPurchase(session, connectedAccount);
    return NextResponse.json({ received: true, outcome });
  } catch (e) {
    // DB等の一時的失敗 → 500 を返して Stripe に再送させる（冪等なので二重記録しない）
    console.error("[stripe-webhook] record failed (will retry):", e);
    return NextResponse.json({ error: "record_failed" }, { status: 500 });
  }
}

async function recordRatingPurchase(
  session: Stripe.Checkout.Session,
  connectedAccount: string,
): Promise<"recorded" | "skipped_unpaid" | "skipped_bad_metadata"> {
  // 即時送信型・買い切り。支払い完了したものだけ記録する。
  if (session.payment_status !== "paid") {
    console.warn(
      `[stripe-webhook] session ${session.id} not paid (${session.payment_status}); skip`,
    );
    return "skipped_unpaid";
  }

  const m = session.metadata ?? {};
  const tierDef = getTier(m.tier); // 価格はサーバー定義が正（原則8）。metadataのamountは信用しない。
  const paymentIntent =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  if (!tierDef || !m.customer_id || !m.salon_id || !m.staff_id || !paymentIntent) {
    // 再送しても直らない不正データ → 200で確認応答（無限再送を避ける）
    console.error("[stripe-webhook] missing/invalid metadata; skip", {
      sessionId: session.id,
      account: connectedAccount,
    });
    return "skipped_bad_metadata";
  }

  // rating_purchases へ記録のみ（残高カラムは無い。賞与連動もしない・原則5・6）。
  const row = {
    customer_id: m.customer_id,
    salon_id: m.salon_id,
    staff_id: m.staff_id,
    review_id: m.review_id || null,
    tier: tierDef.tier,
    amount: tierDef.amount,
    stripe_payment_id: paymentIntent,
  };

  // 冪等: stripe_payment_id(unique) で衝突したら何もしない（= INSERT ... ON CONFLICT DO NOTHING）。
  const { error } = await supabaseAdmin
    .from("rating_purchases")
    .upsert(row, { onConflict: "stripe_payment_id", ignoreDuplicates: true });

  if (error) throw error;

  return "recorded";
}
