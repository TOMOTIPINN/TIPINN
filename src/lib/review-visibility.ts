/**
 * 「その感想を **スタッフ本人** にどこまで見せるか」の判定（純粋モジュール・DB アクセスなし）。
 *
 * ★購入の判定（@/lib/review-purchase）とは別モジュールにする★
 *   §14（2026-09-16）で「購入できる条件」と「本文を見せる条件」は**別の話**になった。
 *     ・購入        … 本人宛て・everyone・未購入（rating は**見ない**）
 *     ・本文の表示  … 本人宛て・everyone・rating>=3
 *   同じ定数を共有すると、片方の都合で閾値を動かしたときにもう片方が黙って一緒に動く。
 *   **この2モジュールは互いに import しない。** 閾値の共有を構造で防ぐ。
 *
 * なぜ rating<=2 の本文を本人に見せないか → docs/00_philosophy.md §4.8
 *   （低評価の言葉は店長のフィルターを通して口頭で伝える設計）。
 *   ただし評価スタンプが贈られていれば「誰からの応援か」は本人に届ける（→ stamp_only）。
 *
 * 店長（manager）経路はここでは扱わない。店長は /manager/inbox で全件を受け止める役割で、
 * rating も share_scope も絞らない（→ docs/40_decisions.md §14）。
 */

/** 本文をスタッフ本人に見せる下限 rating。**購入条件ではない**（購入は rating を見ない）。 */
export const STAFF_BODY_MIN_RATING = 3;

/** スタッフ本人に見せる share_scope。'manager_only' は「店長にだけ伝えたい」という選択なので対象外。 */
export const STAFF_VISIBLE_SHARE_SCOPE = "everyone";

/**
 * スタッフ本人から見た表示モード。
 *   full       … 従来どおり全部（本文・その時の気分・タグ）
 *   stamp_only … **名前とティアだけ**。本文も rating も出さない（§14 決定3）
 *   hidden     … 見せない（一覧に出さない・詳細は 404）
 */
export type StaffViewMode = "full" | "stamp_only" | "hidden";

/** 判定に必要な reviews の列だけ（body は含めない＝取得側で select を絞れる）。 */
export type StaffVisibilityRow = {
  staff_id: string | null;
  share_scope: string | null;
  rating: number | null;
};

/**
 * スタッフ本人に対する表示モード（純粋関数）。
 *
 *   1. 自分宛てでない（staff_id 不一致 / サロン全体宛の null）          → hidden
 *   2. share_scope が 'everyone' でない                                  → hidden
 *   3. rating >= STAFF_BODY_MIN_RATING                                   → full
 *   4. rating <= 2（または null）で、その感想に**有料スタンプがある**    → stamp_only
 *   5. それ以外                                                          → hidden
 *
 * rating が null の行は「本文を出してよい」根拠が無いので 3 に入れない（低評価と同じ扱い）。
 * salon_id は見ない。呼び出し側が ctx.salon_id でクエリを閉じている前提
 * （staff_id は salon_id を一意に決めるが、越境の保険は呼び出し側で二重に掛ける）。
 */
export function staffViewMode(
  review: StaffVisibilityRow | null | undefined,
  viewer: { staffId: string; hasPurchase: boolean },
): StaffViewMode {
  if (!review) return "hidden";
  if (review.staff_id === null) return "hidden";
  if (review.staff_id !== viewer.staffId) return "hidden";
  if (review.share_scope !== STAFF_VISIBLE_SHARE_SCOPE) return "hidden";
  if ((review.rating ?? 0) >= STAFF_BODY_MIN_RATING) return "full";
  return viewer.hasPurchase ? "stamp_only" : "hidden";
}
