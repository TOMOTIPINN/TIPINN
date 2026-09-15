import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { getTier } from "@/lib/rating-tiers";
import { loadReviewForPurchase } from "@/lib/review-server";
import { isPurchasableReview } from "@/lib/review-purchase";

/**
 * POST /api/checkout — 評価スタンプ購入の Stripe Checkout Session を作る（4.1）。
 * Direct Charge：Session を **サロンの連結アカウント上**で作成（`{ stripeAccount }`）。
 *   - mode=payment（買い切り・即時送信型・残高なし / 原則4）
 *   - application_fee_amount は設定しない（=0 / 原則2）。echo は資金を持たない（原則1）。
 *   - customer_id は**サーバーのセッションから**取得（クライアントから受け取らない / 原則7）。
 *   - 価格はサーバーの tier 定義のみ信用。クライアントの amount は破棄（原則8）。
 * 記録（rating_purchases への insert）は Webhook（4.2）で行う。ここでは作らない。
 *
 * ★年齢確認★ 未成年には有料スタンプを販売しない（法務確定）。
 *   ・adult_confirmed が **真偽値 true** でなければ 400（adult_confirmation_required）。
 *     欠落・false・文字列の "true"・"0"・空文字はすべて拒否する。
 *   ・検証は **payload を読んだ直後**＝Stripe はもちろん **salons / staff の DB 参照よりも前**に置く。
 *     確認していないリクエストで DB を引かないため（位置の理由は下の実装コメント参照）。
 *   ・確認した事実は Checkout Session の metadata に adult_confirmed / adult_confirmed_at で残す。
 *     時刻は**サーバー生成**（クライアントの申告時刻を信用しない）。
 *   ・UI（RatingPicker のチェックボックス）は補助。ここが唯一の実効的な関門。
 *
 * ★感想への紐付け（§13 決定3・4 / ステップ5）★
 *   有料スタンプは「声＋評価」の組でのみ売る。チップ（言葉のない送金）化を防ぎ、
 *   「課金されたのにスタッフに届かない」状態を作らないため、**reviewId を必須**にする。
 *   ・reviewId が無い → 400 review_required
 *   ・購入できない感想（他人の／別サロン・別スタッフ宛て／お店のみんなへ／
 *     manager_only／rating<=2）→ 400 invalid_review
 *     ★「存在しない」と「他人のもの」を区別しない★ 区別すると reviewId の総当たりで
 *     実在を判別できるオラクルになる（/staff/received/[reviewId] が 404 に畳むのと同じ理由）。
 *   ・その感想で既に購入済み → 409 already_purchased
 *   判定は **完了画面（/review/complete）と同じ** isPurchasableReview（@/lib/review-purchase）。
 *   ここに条件を書き写さない（2か所に置くと片方だけ直したときに画面と購入結果が食い違う）。
 *
 *   ⚠️ 購入済みチェックは belt にすぎない。Session 作成から webhook 到着までの数秒間に
 *   2回支払われると両方ともここを通過する。**真の砦は migration 0047 の部分一意インデックス**で、
 *   違反は webhook 側が検知して運営者へ通知する（§13 決定5）。
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
    reviewed?: boolean;
    adult_confirmed?: unknown;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { salonId, staffId, tier, reviewId, reviewed } = payload;

  // 年齢確認（法務確定・未成年には販売しない）。
  // ★位置★ payload を読んだ直後＝tier 検証・salons/staff の DB 参照・sessions.create の
  //   **すべてより前**。確認のないリクエストで DB を引かない／Stripe に一切触れないため。
  // ★厳格さ★ 受けるのは真偽値 true のみ。欠落（undefined）・null・false はもちろん、
  //   文字列 "true" / "1" / "on" も拒否する。このエンドポイントの入口は JSON だけで、
  //   フォーム経由（checkbox の "on"）が存在しない＝文字列を許す理由がない。
  //   緩めて「値があれば true」にすると、欠落だけを弾いて false を通してしまう。
  if (payload.adult_confirmed !== true) {
    return NextResponse.json(
      { error: "adult_confirmation_required" },
      { status: 400 },
    );
  }
  // 確認した時刻はサーバーで採る（クライアントの申告時刻を信用しない）。
  const adultConfirmedAt = new Date().toISOString();

  // 価格はサーバー定義のみ信用（原則8）。クライアントが amount を送ってきても見ない。
  const tierDef = getTier(tier);
  if (!salonId || !staffId || !tierDef) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // サロンの連結アカウント（Direct Charge 先）を取得
  const { data: salon } = await supabaseAdmin
    .from("salons")
    .select("name, stripe_account_id, stripe_charges_enabled")
    .eq("id", salonId)
    .single();
  // ★オンボーディング未完了ガード（Phase 2）: stripe_account_id は accounts.create 直後から存在するため、
  //   それだけで通すと審査未完了＝決済不可の状態で checkout が作れてしまう。charges_enabled を基準にする。
  if (!salon?.stripe_account_id || !salon.stripe_charges_enabled) {
    return NextResponse.json({ error: "salon_not_onboarded" }, { status: 409 });
  }

  // staff が当該サロンの所属か確認（評価対象の整合性 / マルチテナント起点 salon_id）。
  // 退職者（archived_at 有り）へは新規評価を受け付けない（過去の実績・台帳は残す）。
  const { data: staff } = await supabaseAdmin
    .from("staff")
    .select("id")
    .eq("id", staffId)
    .eq("salon_id", salonId)
    .is("archived_at", null)
    .single();
  if (!staff) {
    return NextResponse.json({ error: "invalid_staff" }, { status: 400 });
  }

  // 感想への紐付け（§13 ステップ5）。**Stripe に触れる前**に3段で弾く。
  //   位置は staff 在籍チェックの直後＝salon / staff が確定してから照合する
  //   （isPurchasableReview が salon_id / staff_id の一致を見るため、先に確定させる必要がある）。

  // (1) reviewId は必須。空文字・空白のみも拒否する。
  if (typeof reviewId !== "string" || reviewId.trim() === "") {
    return NextResponse.json({ error: "review_required" }, { status: 400 });
  }

  // (2) 購入できる感想か。判定は完了画面と同じ純粋関数に委ねる（条件をここに書き写さない）。
  //     customerId は **セッション由来**（クライアントの申告は使わない）。
  const review = await loadReviewForPurchase(reviewId);
  if (
    !isPurchasableReview(review, {
      customerId: session.customer_id,
      salonId,
      staffId,
    })
  ) {
    // 存在しない / 他人の / 条件外 をすべて同じコードに畳む（オラクルにしない）。
    return NextResponse.json({ error: "invalid_review" }, { status: 400 });
  }

  // (3) その感想で既に購入済みか（1感想1スタンプ・§13 決定4）。
  //     ここは親切なエラーを返すための belt。真の砦は 0047 の部分一意インデックス。
  const { count: purchasedCount } = await supabaseAdmin
    .from("rating_purchases")
    .select("id", { count: "exact", head: true })
    .eq("review_id", reviewId);
  if ((purchasedCount ?? 0) > 0) {
    return NextResponse.json({ error: "already_purchased" }, { status: 409 });
  }

  const baseUrl = process.env.APP_BASE_URL!;
  // 感想送信済みなら決済キャンセルで rating に戻っても「感想だけ送る」を再表示しない。
  // 値があるときだけ付ける（無ければ現状どおり＝表示側でフェイルセーフ）。
  const reviewedParam = reviewed ? "&reviewed=1" : "";
  // どの感想への評価かを cancel_url にも維持する（§13 ステップ4）。
  //   これが無いと「1回目キャンセル → /rating に戻って2回目」の人だけ reviewId を失い、
  //   metadata.review_id が付かない＝感想に紐づかない購入になる。
  //   ステップ5で reviewId を必須化すると、この経路が丸ごと 400 になる。
  //   reviewed と同じ作法（値があるときだけ付ける）。
  const reviewParam = reviewId
    ? `&review=${encodeURIComponent(reviewId)}`
    : "";

  // Webhook(4.2) が rating_purchases に記録するための手がかり。すべて文字列。
  const metadata: Record<string, string> = {
    customer_id: session.customer_id,
    salon_id: salonId,
    staff_id: staffId,
    tier: tierDef.tier,
    amount: String(tierDef.amount),
    // 年齢確認の記録（既存キーは変えない・消さない）。webhook / rating_purchases は不変で、
    // ここは Stripe 側に事実を残すためだけに使う（監査・問い合わせ時の照合用）。
    adult_confirmed: "true",
    adult_confirmed_at: adultConfirmedAt,
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
        cancel_url: `${baseUrl}/rating?salon=${salonId}&staff=${staffId}${reviewedParam}${reviewParam}`,
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
