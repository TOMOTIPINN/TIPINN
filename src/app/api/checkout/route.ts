import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { getTier } from "@/lib/rating-tiers";

/**
 * POST /api/checkout — 評価スタンプ購入の Stripe Checkout Session を作る（4.1）。
 * Direct Charge：Session を **サロンの連結アカウント上**で作成（`{ stripeAccount }`）。
 *   - mode=payment（買い切り・即時送信型・残高なし / 原則4）
 *   - application_fee_amount は設定しない（=0 / 原則2）。echo は資金を持たない（原則1）。
 *   - customer_id は**サーバーのセッションから**取得（クライアントから受け取らない / 原則7）。
 *   - 価格はサーバーの tier 定義のみ信用。クライアントの amount は破棄（原則8）。
 * 記録（rating_purchases への insert）は Webhook（4.2）で行う。ここでは作らない。
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.customer_id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: {
    salonId?: string;
    staffId?: string;
    tier?: string;
    reviewId?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { salonId, staffId, tier, reviewId } = payload;
  // 価格はサーバー定義のみ信用（原則8）。クライアントが amount を送ってきても見ない。
  const tierDef = getTier(tier);
  if (!salonId || !staffId || !tierDef) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // サロンの連結アカウント（Direct Charge 先）を取得
  const { data: salon } = await supabaseAdmin
    .from("salons")
    .select("name, stripe_account_id")
    .eq("id", salonId)
    .single();
  if (!salon?.stripe_account_id) {
    return NextResponse.json({ error: "salon_not_onboarded" }, { status: 409 });
  }

  // staff が当該サロンの所属か確認（評価対象の整合性 / マルチテナント起点 salon_id）
  const { data: staff } = await supabaseAdmin
    .from("staff")
    .select("id")
    .eq("id", staffId)
    .eq("salon_id", salonId)
    .single();
  if (!staff) {
    return NextResponse.json({ error: "invalid_staff" }, { status: 400 });
  }

  const baseUrl = process.env.APP_BASE_URL!;

  // Webhook(4.2) が rating_purchases に記録するための手がかり。すべて文字列。
  const metadata: Record<string, string> = {
    customer_id: session.customer_id,
    salon_id: salonId,
    staff_id: staffId,
    tier: tierDef.tier,
    amount: String(tierDef.amount),
  };
  if (reviewId) metadata.review_id = reviewId;

  try {
    const checkout = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "jpy", // ゼロ小数通貨 → unit_amount は円そのまま
              unit_amount: tierDef.amount,
              product_data: {
                name: `評価スタンプ「${tierDef.label}」（${salon.name}）`,
              },
            },
          },
        ],
        // application_fee_amount は設定しない（=0・原則2）
        payment_intent_data: { metadata },
        metadata,
        client_reference_id: session.customer_id,
        success_url: `${baseUrl}/rating/complete?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/rating?salon=${salonId}&staff=${staffId}`,
      },
      // Direct Charge：連結アカウント上で Session を作成（手数料は連結アカウント負担）
      { stripeAccount: salon.stripe_account_id },
    );

    if (!checkout.url) {
      return NextResponse.json({ error: "checkout_failed" }, { status: 500 });
    }
    return NextResponse.json({ url: checkout.url });
  } catch (e) {
    console.error("checkout create failed:", e);
    return NextResponse.json({ error: "checkout_failed" }, { status: 500 });
  }
}
