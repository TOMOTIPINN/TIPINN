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
 * 購入できるのは「**本人が・担当スタッフ宛てに送った感想**」:
 *   有料スタンプはスタッフ個人への評価として届く（/staff/received/[reviewId]）。
 *
 * ★share_scope は見ない（§19・2026-09-17 で条件から外した）★
 *   お客様が `manager_only` で選んだのは **本文の届け先**であって、
 *   **応援を贈らないこと**ではない。
 *   かつて条件に入れていた理由（「課金されたのにスタッフに届かない」）は
 *   **表示側（@/lib/review-visibility）で解いた**＝購入があれば share_scope によらず
 *   **お客様の名前・ティア・rating** が本人に届く（本文とタグは everyone かつ rating>=3 のみ）。
 *   → docs/40_decisions.md §19 決定1・2・3
 *
 * ★rating は見ない（§14・2026-09-16 で条件から外した）★
 *   rating<=2 の感想にも評価スタンプを贈れる。贈られた場合は本人に
 *   **お客様の表示名・ティア・rating** が届く（本文とタグは出さない。
 *   rating を届ける点は §19 決定2 で §14 決定3 を上書きした）。
 *   → docs/00_philosophy.md §4.8 / docs/40_decisions.md §14・§19 / @/lib/review-visibility
 *
 * ★表示側の閾値とこのモジュールは無関係★
 *   本文を見せる下限（STAFF_BODY_MIN_RATING）は @/lib/review-visibility にある。
 *   **このモジュールは review-visibility を import しない。**
 *   同じ定数を共有すると、購入の都合で本文の可視性が黙って動く。
 */

/**
 * 判定に必要な reviews の列だけ（body は含めない＝取得側で select を絞れる）。
 * **rating は入れない**（§14 で購入条件から外した）。
 * **share_scope も入れない**（§19 で購入条件から外した）。列として残すと、後から
 * この場に閾値や共有範囲の条件を書き戻す余地が生まれる。
 */
export type PurchasableReviewRow = {
  id: string;
  customer_id: string;
  salon_id: string;
  staff_id: string | null;
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
 *
 * **rating も share_scope も条件に入らない**（§14 ／ §19）。
 * 低評価の感想にも `manager_only` の感想にも贈れる。
 * 「未購入」は**この関数の外**（一意インデックス 0047 と呼び出し側）で担保する。
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
  return true;
}
