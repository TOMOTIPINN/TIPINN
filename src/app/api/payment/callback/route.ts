import { NextRequest, NextResponse } from "next/server";

/**
 * PayPay決済コールバックAPI
 *
 * PayPayでの決済完了後にリダイレクトされるエンドポイント。
 * 決済結果を検証し、DBのステータスを更新した後、
 * サンクスページにリダイレクトする。
 */

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const merchantPaymentId = searchParams.get("merchantPaymentId");
  const paymentStatus = searchParams.get("paymentStatus") || "SUCCESS";

  if (!merchantPaymentId) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // MVP: 決済結果の検証（本番ではPayPay APIで確認）
  //
  // const paypay = new PAYPAY({ ... });
  // const result = await paypay.GetPaymentDetails(merchantPaymentId);
  //
  // if (result.resultInfo.code === 'SUCCESS') {
  //   // DB更新: tips.status = 'completed'
  // }

  if (paymentStatus === "SUCCESS") {
    // サンクスページにリダイレクト
    return NextResponse.redirect(
      new URL(
        `/carta/maria/thanks?paymentId=${merchantPaymentId}`,
        request.url
      )
    );
  }

  // 決済失敗の場合
  return NextResponse.redirect(
    new URL(`/?error=payment_failed`, request.url)
  );
}
