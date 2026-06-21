/**
 * 評価スタンプ（有償）の tier 定義 — **価格の唯一の正（サーバー権威）**。
 * 価格は echo が固定（原則8）。クライアントから送られてくる amount は信用せず破棄し、
 * 必ずこの定義の amount を使う。CLAUDE.md §6 / DBの CHECK制約（0003→最新は0005）と一致させること。
 *
 * 税込・JPY はゼロ小数通貨 → Stripe の unit_amount は「円そのまま」。
 */
// emoji は各ティアの「単一ソース」。顧客向け /rating と内部ダッシュボードの内訳チップが
// ともにここを参照する（重複定義しない）。評価スタンプの見た目は従来通りが正。
// ⚠️ このティア絵文字は今後も触らない。ポイントヘッドライン等と被る場合は「ポイント側のアイコン」を変える。
export const RATING_TIERS = [
  { tier: "thank_you", amount: 100, label: "Thank you", emoji: "👍" },
  { tier: "grateful", amount: 500, label: "Grateful", emoji: "☕" },
  { tier: "wonderful", amount: 1000, label: "Wonderful", emoji: "🍰" },
  { tier: "amazing", amount: 3000, label: "Amazing", emoji: "💐" },
  { tier: "unforgettable", amount: 10000, label: "Unforgettable", emoji: "👑" },
] as const;

export type RatingTier = (typeof RATING_TIERS)[number]["tier"];
export type RatingTierDef = (typeof RATING_TIERS)[number];

/** tier 文字列から定義を引く。未知の tier は null（＝クライアント値を信用しない）。 */
export function getTier(tier: unknown): RatingTierDef | null {
  if (typeof tier !== "string") return null;
  return RATING_TIERS.find((t) => t.tier === tier) ?? null;
}
