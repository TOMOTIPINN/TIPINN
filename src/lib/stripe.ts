import Stripe from "stripe";

/**
 * Stripe サーバー専用クライアント（テストモード sk_test_）。
 * 評価スタンプは Stripe Connect の **Direct Charge**：Checkout Session を連結アカウント上で
 * 作成する（`{ stripeAccount }` リクエストオプション）。echo は資金を持たず（原則1）、
 * application_fee は付けない（=0・原則2）。絶対にクライアントから import しないこと。
 */
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

/**
 * Account Links（Standard 向け Connect Onboarding・Phase 2）の共通 URL。
 *   - refresh_url: リンクは数分で失効し、リロード・戻る/進むでも来るため必須。ここで再生成して再リダイレクト。
 *   - return_url : オンボーディング完了（または離脱）で戻る先。状態を retrieve して保存する。
 * OAuth 方式は使わない（Stripe が新規プラットフォームに非推奨のため）。
 */
export function stripeOnboardingUrls(baseUrl: string): {
  refresh_url: string;
  return_url: string;
} {
  return {
    refresh_url: `${baseUrl}/api/manager/stripe/refresh`,
    return_url: `${baseUrl}/api/manager/stripe/return`,
  };
}
