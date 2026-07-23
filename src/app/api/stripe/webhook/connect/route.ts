import { NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getTier } from "@/lib/rating-tiers";
import {
  claimStripeEvent,
  markStripeEventProcessed,
} from "@/lib/stripe-events";

/**
 * POST /api/stripe/webhook/connect — Connect（連結アカウント）イベントの受信（フェーズ4.2 / Phase 2）。
 *
 * ★Direct Charge なので checkout.session.completed は **Connect イベント**として届く
 *   （event.account に連結アカウントIDが入る）。署名検証には **Connect エンドポイント専用**の
 *   署名シークレット STRIPE_CONNECT_WEBHOOK_SECRET を使う。
 *   （platform イベントは別ルート /api/stripe/webhook が STRIPE_WEBHOOK_SECRET で受ける。）
 *
 * やること:
 *   - checkout.session.completed → session.metadata を読み rating_purchases に INSERT。
 *   - account.updated → 連結アカウントの審査状態を salons に同期（オンボーディング Phase 2）。
 *   - 冪等（第一層・0032 stripe_events）: 署名検証直後にイベントを (id, type, salon_id, payload) で
 *     記録し、処理済み(processed_at NOT NULL)の再送は実処理を丸ごとスキップする。
 *     二重配信で消込・課金が二重に走らないための最上位ガード。
 *     salon_id は event.account を salons.stripe_account_id で引いて埋める（引けなければ NULL）。
 *   - 冪等（第二層）: stripe_payment_id(= payment_intent) の unique で二重記録を防ぐ（ON CONFLICT DO NOTHING）。
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
    console.error("[stripe-webhook/connect] missing signature or secret");
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (e) {
    console.error("[stripe-webhook/connect] signature verification failed:", e);
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  // salon_id を event.account から解決（引けなければ NULL・エラーにしない・処理は継続）。
  const salonId = await resolveSalonIdByAccount(event.account ?? null);

  // 冪等の第一層（0032 stripe_events）: 署名検証が通った直後にイベントを記録し、
  // 処理済みの再送は実処理へ入れない。二重配信での二重課金・二重消込を最上位で止める。
  let claim: Awaited<ReturnType<typeof claimStripeEvent>>;
  try {
    claim = await claimStripeEvent(event, salonId);
  } catch (e) {
    // イベント記録自体に失敗 → まだ何も処理していない。500 で Stripe に再送させる。
    console.error("[stripe-webhook/connect] event dedup failed (will retry):", e);
    return NextResponse.json({ error: "dedup_failed" }, { status: 500 });
  }
  if (claim === "already_processed") {
    // 二重配信。実処理をスキップして確認応答のみ（Stripeの再送を止める）。
    return NextResponse.json({ received: true, duplicate: true });
  }
  // claim === "claimed"（新規受信）/ "retry"（受信済みだが前回処理が途中失敗＝未処理）→ 実処理へ。

  try {
    let outcome:
      | "recorded"
      | "skipped_unpaid"
      | "skipped_bad_metadata"
      | "account_synced"
      | "account_not_found"
      | "ignored_event_type" = "ignored_event_type";

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      // Direct Charge: 連結アカウント上のイベント。account に連結アカウントIDが入る（ログ用）。
      const connectedAccount = event.account ?? "(none)";
      outcome = await recordRatingPurchase(session, connectedAccount);
    } else if (event.type === "account.updated") {
      // Connect イベント（オンボーディング Phase 2）。連結アカウントの審査状態を salons に同期。
      // 既存の stripe_events 冪等化（claim/markProcessed）にそのまま乗る。
      const account = event.data.object as Stripe.Account;
      outcome = await syncAccountFromStripe(account);
    }

    // 実処理が正常終了 → processed_at を打つ（以後この event は再送でも弾かれる）。
    await markStripeEventProcessed(event.id);
    return NextResponse.json({ received: true, outcome });
  } catch (e) {
    // DB等の一時的失敗 → 500 を返して Stripe に再送させる。processed_at は打たれないので
    //   次回は "retry" として実処理をやり直せる（rating_purchases は冪等なので二重記録しない）。
    console.error("[stripe-webhook/connect] record failed (will retry):", e);
    return NextResponse.json({ error: "record_failed" }, { status: 500 });
  }
}

/**
 * event.account（連結アカウントID）を salons.stripe_account_id で引いて salon_id を解決する。
 *   - account が無い / 該当サロンが無い → null（stripe_events.salon_id は NULL のまま・エラーにしない）。
 *   - 引く途中の DB エラーも握りつぶして null を返す（冪等記録・実処理は継続する）。
 */
async function resolveSalonIdByAccount(
  account: string | null,
): Promise<string | null> {
  if (!account) return null;
  const { data, error } = await supabaseAdmin
    .from("salons")
    .select("id")
    .eq("stripe_account_id", account)
    .maybeSingle();
  if (error) {
    // salon_id の埋め込みは補助情報。解決に失敗しても本処理は止めない（NULL のまま継続）。
    console.error(
      "[stripe-webhook/connect] salon_id resolve failed (continue with null):",
      error,
    );
    return null;
  }
  return data?.id ?? null;
}

/**
 * account.updated（Phase 2）→ salons の審査状態フラグを同期する。
 *   details_submitted / charges_enabled / payouts_enabled のみ更新（記録・金額には触れない・原則5/6）。
 *   stripe_connected_at は onboard 時（アカウント作成時）に刻む唯一のソースなのでここでは触らない。
 * 該当サロンが無い（他プラットフォームのアカウント等）→ "account_not_found"（200で受け流す）。
 */
async function syncAccountFromStripe(
  account: Stripe.Account,
): Promise<"account_synced" | "account_not_found"> {
  const { data, error } = await supabaseAdmin
    .from("salons")
    .update({
      stripe_details_submitted: account.details_submitted ?? false,
      stripe_charges_enabled: account.charges_enabled ?? false,
      stripe_payouts_enabled: account.payouts_enabled ?? false,
    })
    .eq("stripe_account_id", account.id)
    .select("id");

  if (error) throw error;
  return (data?.length ?? 0) > 0 ? "account_synced" : "account_not_found";
}

async function recordRatingPurchase(
  session: Stripe.Checkout.Session,
  connectedAccount: string,
): Promise<"recorded" | "skipped_unpaid" | "skipped_bad_metadata"> {
  // 即時送信型・買い切り。支払い完了したものだけ記録する。
  if (session.payment_status !== "paid") {
    console.warn(
      `[stripe-webhook/connect] session ${session.id} not paid (${session.payment_status}); skip`,
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
    console.error("[stripe-webhook/connect] missing/invalid metadata; skip", {
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
