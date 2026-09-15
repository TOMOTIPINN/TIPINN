/**
 * 「この感想に有料スタンプを購入できるか」の判定（純粋モジュール・DB アクセスなし）。
 *
 * 単一ソースにする理由:
 *   同じ条件を **2か所**で使う。
 *     1. /review/complete … 「評価スタンプを送る」リンクを出すかどうか（belt）
 *     2. /api/checkout    … 購入を受け付けるかどうか（★真の砦★・ステップ5で追加）
 *   片方だけ変えると「リンクは出るのに購入は弾かれる」「リンクが無いのに直URLで買える」
 *   が生まれる。判定はここ1か所に閉じ、DB 取得は @/lib/review-server に置く
 *   （supabaseAdmin をクライアントバンドルに巻き込まない・review.ts / review-server.ts と同じ分離）。
 *
 * 購入できるのは「**スタッフ本人に届く感想**」だけ:
 *   有料スタンプはスタッフ個人への評価として届く（/staff/received/[reviewId]）。
 *   本人が読めない感想に課金できると「課金されたのにスタッフに届かない」状態になる。
 *   可視条件は /staff/received/[reviewId] の canView（staff 経路）と同じ2つ
 *   （share_scope='everyone' かつ rating>=3）に、宛先が個人であること（staff_id 非 null）を足したもの。
 */

/** 購入可能と見なす share_scope。'manager_only' は本人に届かないので対象外。 */
export const PURCHASE_SHARE_SCOPE = "everyone";

/**
 * 購入可能と見なす最低 rating。
 * rating<=2（気づきの声）は店長が受け止める設計（docs/00_philosophy.md）で
 * 本人には直接見せないため、課金の対象にもしない。
 * /staff/received/[reviewId] の canView と同じ値。
 */
export const PURCHASE_MIN_RATING = 3;

/** 判定に必要な reviews の列だけ（body は含めない＝取得側で select を絞れる）。 */
export type PurchasableReviewRow = {
  id: string;
  customer_id: string;
  salon_id: string;
  staff_id: string | null;
  share_scope: string | null;
  rating: number | null;
};

/** 誰が・どのサロンの・どのスタッフ宛てとして購入しようとしているか。 */
export type PurchaseTarget = {
  /** セッション由来の顧客 id（**クライアントから受け取らない**）。 */
  customerId: string;
  /** URL / リクエストで指定されたサロン。 */
  salonId: string;
  /** URL / リクエストで指定されたスタッフ。未指定は null。 */
  staffId: string | null;
};

/**
 * その感想に有料スタンプを購入してよいか（純粋関数）。
 *
 * すべて満たすときだけ true:
 *   1. 感想が存在する
 *   2. **本人の感想**（customer_id が一致）… 他人の reviewId を指定されても通さない
 *   3. サロンが一致
 *   4. **宛先が個人**（staff_id が非 null）かつ指定スタッフと一致
 *      … 「お店のみんなへ」（staff_id null）は個人に届かないので対象外。
 *        null === null で素通りしないよう、非 null を先に確かめる。
 *   5. share_scope が 'everyone'
 *   6. rating が PURCHASE_MIN_RATING 以上（null は 0 扱いで不可）
 */
export function isPurchasableReview(
  review: PurchasableReviewRow | null | undefined,
  target: PurchaseTarget,
): boolean {
  if (!review) return false;
  if (review.customer_id !== target.customerId) return false;
  if (review.salon_id !== target.salonId) return false;
  if (review.staff_id === null) return false;
  if (review.staff_id !== target.staffId) return false;
  if (review.share_scope !== PURCHASE_SHARE_SCOPE) return false;
  if ((review.rating ?? 0) < PURCHASE_MIN_RATING) return false;
  return true;
}
