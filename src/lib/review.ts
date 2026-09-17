/**
 * 感想（reviews）の入力ルール（単一ソース）。
 * クライアント（フォーム）とサーバー（/api/reviews）で同じ定数・検証を共有し、
 * ルールがズレないようにする。画面マップ03に対応。
 */

/* ---- 受付期間（migration 0046） ---- */
/**
 * 感想を受け付ける日数。来店日から数えてこの日数まで（当日を含む暦日で N+1 日分）。
 * 例: REVIEW_WINDOW_DAYS=3 なら 15日に来店 → 18日まで受け付ける。
 *
 * ★RPC submit_review_and_earn_stamp（0046）の v_window_days と**必ず一致させること**★
 *   片方だけ変えると、画面は受け付けるのに RPC が弾く（またはその逆）状態になる。
 *   ここに置くのは、server（review-server.ts）と client（ReviewForm）の両方が読むため
 *   （このモジュールは DB アクセスを持たない純粋モジュール）。
 */
export const REVIEW_WINDOW_DAYS = 3;

/* ---- コメント本文（trim後の文字数で判定） ---- */
export const REVIEW_BODY_MIN = 15;
export const REVIEW_BODY_MAX = 300;

export function validateReviewBody(
  body: string,
): "empty" | "too_short" | "too_long" | null {
  const len = body.trim().length;
  if (len === 0) return "empty";
  if (len < REVIEW_BODY_MIN) return "too_short";
  if (len > REVIEW_BODY_MAX) return "too_long";
  return null;
}

/* ---- 絵文字評価 4段階（最高/よい/普通/改善 → rating 4..1） ---- */
export const REVIEW_RATINGS = [
  { value: 4, emoji: "😊", label: "最高" },
  { value: 3, emoji: "🙂", label: "よい" },
  { value: 2, emoji: "😐", label: "普通" },
  { value: 1, emoji: "🙁", label: "改善" },
] as const;

export type Rating = 1 | 2 | 3 | 4;

export function isValidRating(r: unknown): r is Rating {
  return typeof r === "number" && Number.isInteger(r) && r >= 1 && r <= 4;
}

/* ---- 体験タグ（複数可）。当面はハードコード。将来 A4 タグ設定で可変化 ---- */
export const REVIEW_TAGS = [
  "受付",
  "カウンセリング",
  "技術",
  "挨拶",
  "居心地",
  "仕上がり",
] as const;

/** 受け取ったタグを許可集合で正規化（重複除去）。不正値が混ざれば null。 */
export function normalizeTags(tags: unknown): string[] | null {
  if (tags == null) return [];
  if (!Array.isArray(tags)) return null;
  const allowed = new Set<string>(REVIEW_TAGS);
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t !== "string" || !allowed.has(t)) return null;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/* ---- 共有範囲（店長のみ/お店のスタッフに） ----
   everyone は「お店のスタッフ全員が Team voices で読む」の意味（外部公開ではない）。
   ラベルに「お店の」を付けて外部公開でないことを示し、宛先フィールドの
   「お店のみんなへ」（＝誰への感想か）と語を差別化する（可視性 vs 宛先の混同防止）。 */
export const SHARE_SCOPES = [
  { value: "manager_only", label: "店長のみ" },
  { value: "everyone", label: "お店のスタッフに" },
] as const;

export type ShareScope = (typeof SHARE_SCOPES)[number]["value"];

export function isValidShareScope(s: unknown): s is ShareScope {
  return SHARE_SCOPES.some((x) => x.value === s);
}

/* ---- 評価スタンプ購入画面（/rating）へのリンク ---- */

/**
 * 「評価スタンプを送る」の遷移先を組み立てる（§15）。
 *
 * 購入画面は **salon / staff / review の3点セット**を要求する。
 * `isPurchasableReview`（@/lib/review-purchase）が「本人・当該サロン/スタッフ宛て・
 * everyone・未購入」を見るため、staff と review のどちらが欠けても購入できない。
 *
 * `reviewed=1` を必ず付ける: 決済をキャンセルして /rating に戻ったときに
 * 「感想だけ送る」を再表示しないためのフラグ（/api/checkout のコメントと同じ意図）。
 *
 * ※ /review/complete も同じ形の URL を組み立てているが、**あちらは購入導線の一部**なので
 *   §15 では触らない（この関数を使うのは /mypage だけ）。寄せ替えるなら別途。
 */
export function ratingHref(params: {
  salonId: string;
  staffId: string;
  reviewId: string;
}): string {
  const q = new URLSearchParams({
    salon: params.salonId,
    staff: params.staffId,
    reviewed: "1",
    review: params.reviewId,
  });
  return `/rating?${q.toString()}`;
}
