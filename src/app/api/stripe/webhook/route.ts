import { NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import {
  claimStripeEvent,
  markStripeEventProcessed,
} from "@/lib/stripe-events";

/**
 * POST /api/stripe/webhook — platform（echo プラットフォーム自身）イベントの受信。
 *
 * ★これは **platform エンドポイント**。署名検証には platform 用シークレット
 *   STRIPE_WEBHOOK_SECRET を使う（Connect イベントは別ルート /api/stripe/webhook/connect が
 *   STRIPE_CONNECT_WEBHOOK_SECRET で受ける）。
 *
 * 現時点で platform 側に実処理すべきイベントは無い（echo は資金を持たない・原則1／
 *   月額サブスク等の自社課金も未実装）。したがって:
 *   - 署名検証 → stripe_events へ冪等記録（0032）→ 200 を返す、までで完結する。
 *   - すべてのイベント種別を outcome = "ignored_event_type" として受け流す。
 *   - salon_id は常に NULL（platform イベントは連結アカウントに紐づかない）。
 * 将来 platform イベントを処理するときは、この分岐に実処理を足す（冪等記録の枠はそのまま使える）。
 */
export const runtime = "nodejs"; // Stripe SDK / 署名検証は Node ランタイムで

export async function POST(req: Request) {
  // 生body（request.text()）で署名検証する。JSONパースより前に読むこと。
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !secret) {
    console.error("[stripe-webhook/platform] missing signature or secret");
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (e) {
    console.error("[stripe-webhook/platform] signature verification failed:", e);
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  // 冪等の第一層（0032 stripe_events）: platform イベントは salon_id を持たない（NULL 固定）。
  let claim: Awaited<ReturnType<typeof claimStripeEvent>>;
  try {
    claim = await claimStripeEvent(event, null);
  } catch (e) {
    // イベント記録自体に失敗 → まだ何も処理していない。500 で Stripe に再送させる。
    console.error("[stripe-webhook/platform] event dedup failed (will retry):", e);
    return NextResponse.json({ error: "dedup_failed" }, { status: 500 });
  }
  if (claim === "already_processed") {
    // 二重配信。実処理をスキップして確認応答のみ（Stripeの再送を止める）。
    return NextResponse.json({ received: true, duplicate: true });
  }
  // claim === "claimed"（新規受信）/ "retry"（受信済みだが前回処理が途中失敗＝未処理）→ 実処理へ。

  try {
    // 現時点で platform 側に実処理すべきイベントは無い。すべて ignored_event_type。
    const outcome: "ignored_event_type" = "ignored_event_type";

    // 実処理なし（記録のみ）→ processed_at を打つ（以後この event は再送でも弾かれる）。
    await markStripeEventProcessed(event.id);
    return NextResponse.json({ received: true, outcome });
  } catch (e) {
    // DB等の一時的失敗 → 500 を返して Stripe に再送させる。processed_at は打たれないので
    //   次回は "retry" として再実行できる（記録は冪等なので二重にならない）。
    console.error("[stripe-webhook/platform] record failed (will retry):", e);
    return NextResponse.json({ error: "record_failed" }, { status: 500 });
  }
}
