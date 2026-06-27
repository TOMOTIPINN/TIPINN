/**
 * 感想（reviews）の入力ルール（単一ソース）。
 * クライアント（フォーム）とサーバー（/api/reviews）で同じ定数・検証を共有し、
 * ルールがズレないようにする。画面マップ03に対応。
 */

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

/* ---- 共有範囲（店長のみ/全員に/どちらでも） ---- */
export const SHARE_SCOPES = [
  { value: "manager_only", label: "店長のみ" },
  { value: "everyone", label: "全員に" },
  { value: "either", label: "どちらでも" },
] as const;

export type ShareScope = (typeof SHARE_SCOPES)[number]["value"];

export function isValidShareScope(s: unknown): s is ShareScope {
  return SHARE_SCOPES.some((x) => x.value === s);
}
