import Stripe from "stripe";

/**
 * Stripe サーバー専用クライアント（テストモード sk_test_）。
 * 評価スタンプは Stripe Connect の **Direct Charge**：Checkout Session を連結アカウント上で
 * 作成する（`{ stripeAccount }` リクエストオプション）。echo は資金を持たず（原則1）、
 * application_fee は付けない（=0・原則2）。絶対にクライアントから import しないこと。
 */
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
