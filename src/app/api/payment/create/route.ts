import { NextRequest, NextResponse } from "next/server";

/**
 * PayPay決済作成API
 *
 * MVP段階ではモック実装。
 * 本番ではPayPay Web Payment APIを使用して決済を作成し、
 * PayPayアプリ起動URLを返す。
 *
 * PayPay API ドキュメント:
 * https://developer.paypay.ne.jp/products/docs/webpayment
 */

interface CreatePaymentRequest {
  stylistId: string;
  amount: number;
  message?: string;
  senderName?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: CreatePaymentRequest = await request.json();

    // Validation
    if (!body.stylistId || !body.amount || body.amount < 100) {
      return NextResponse.json(
        { error: "スタイリストIDと金額（100円以上）は必須です" },
        { status: 400 }
      );
    }

    if (body.amount > 100000) {
      return NextResponse.json(
        { error: "金額は100,000円以下にしてください" },
        { status: 400 }
      );
    }

    // MVP: モック決済処理
    // 本番では以下のPayPay APIを呼び出す:
    //
    // const paypay = new PAYPAY({
    //   API_KEY: process.env.PAYPAY_API_KEY,
    //   API_SECRET: process.env.PAYPAY_API_SECRET,
    //   MERCHANT_ID: process.env.PAYPAY_MERCHANT_ID,
    // });
    //
    // const response = await paypay.QRCodeCreate({
    //   merchantPaymentId: `tip-${Date.now()}`,
    //   amount: { amount: body.amount, currency: "JPY" },
    //   orderDescription: `tipinn - ${body.amount}円の応援`,
    //   redirectUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/api/payment/callback`,
    //   redirectType: "WEB_LINK",
    // });

    const mockPaymentId = `mock-${Date.now()}-${Math.random()
      .toString(36)
      .substring(7)}`;

    // モック: PayPayアプリ起動URL（本番ではAPIレスポンスから取得）
    const mockPayPayUrl = `https://www.paypay.ne.jp/app/cashier?merchantPaymentId=${mockPaymentId}`;

    return NextResponse.json({
      success: true,
      paymentId: mockPaymentId,
      payPayUrl: mockPayPayUrl,
      amount: body.amount,
    });
  } catch (error) {
    console.error("Payment creation error:", error);
    return NextResponse.json(
      { error: "決済の作成に失敗しました" },
      { status: 500 }
    );
  }
}
