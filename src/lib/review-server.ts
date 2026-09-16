/**
 * 感想（reviews）のサーバー専用ヘルパー（supabaseAdmin 依存・RLS deny-by-default / CLAUDE.md §8）。
 *
 * lib/review.ts はクライアントと共有する純粋モジュールなので、DB アクセスはここに分離する
 * （supabaseAdmin をクライアントバンドルに巻き込まない）。
 *
 * 「1来店につき感想1回」の重複制限の UX ベルト（ページロード時の既送信判定）。
 * 本当の砦は RPC submit_review_and_earn_stamp（0046・advisory lock 内で判定）。ここは表示の出し分け用。
 * **判定条件は RPC と一字一句そろえること**（ズレると画面と送信結果が食い違う）。
 */
import { supabaseAdmin } from "@/lib/supabase-admin";
import { REVIEW_WINDOW_DAYS } from "@/lib/review";
import type { PurchasableReviewRow } from "@/lib/review-purchase";

/** JST は UTC+9 固定（サマータイム無し）。dashboard-data / staff-stats と同じ前提。 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 現在時刻の JST 暦日を 'YYYY-MM-DD' で返す（visits.visited_on は date 型＝文字列比較できる）。 */
function jstToday(nowMs: number = Date.now()): string {
  return new Date(nowMs + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** JST 暦日を days 日だけ戻した 'YYYY-MM-DD'。 */
function jstDateMinusDays(days: number, nowMs: number = Date.now()): string {
  return jstToday(nowMs - days * 86_400_000);
}

/**
 * JST 暦日 'YYYY-MM-DD' の 0 時を UTC-ISO で返す（timestamptz にそのまま比較できる）。
 * line-push の hasReviewAndPurchase と同じ作法。
 */
function jstDayStartISO(jstDate: string): string {
  return new Date(`${jstDate}T00:00:00+09:00`).toISOString();
}

/**
 * 「今回のご来店ぶん」の感想を既に送っているか（RPC 0046 の already_submitted と同じ判定）。
 *
 * 手順は RPC と同じ2段:
 *   1. 受付期間内（[今日-REVIEW_WINDOW_DAYS, 今日]）の最終来店日 v_last_visit を取る。
 *   2. その日以降（JST 暦日で >=）に reviews があれば「送信済み」。
 *
 * 受付期間内に来店が無い場合は **false**（＝フォームを出す）。
 *   ここで true を返すと「送信済み」画面になり、来店していない人に誤った案内が出る。
 *   来店なしの拒否は RPC の 'no_visit_today'（→ 409 → フォーム上のエラー文言）が担当する。
 *
 * 判定単位は RPC/スタンプと同一で **(顧客, サロン)**。staff は問わない。
 */
export async function hasReviewedForLatestVisit(
  customerId: string,
  salonId: string,
): Promise<boolean> {
  const today = jstToday();
  const windowStart = jstDateMinusDays(REVIEW_WINDOW_DAYS);

  // 1) 受付期間内の最終来店日（visited_on は date 型なので 'YYYY-MM-DD' の文字列比較でよい）。
  const { data: visit } = await supabaseAdmin
    .from("visits")
    .select("visited_on")
    .eq("customer_id", customerId)
    .eq("salon_id", salonId)
    .gte("visited_on", windowStart)
    .lte("visited_on", today)
    .order("visited_on", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 受付期間内の来店なし＝このベルトでは何も言わない（RPC 側で no_visit_today として弾く）。
  if (!visit?.visited_on) return false;

  // 2) その最終来店日以降に感想があるか。
  const { count } = await supabaseAdmin
    .from("reviews")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .eq("salon_id", salonId)
    .gte("created_at", jstDayStartISO(visit.visited_on));

  return (count ?? 0) > 0;
}

/**
 * 有料スタンプの購入可否を判定するために、reviews を1件引く（判定はしない）。
 *
 * **取得と判定を分ける**: 判定は @/lib/review-purchase の isPurchasableReview（純粋関数）。
 * ここは「判定に必要な列だけを引いてくる」責務に閉じる。
 *
 * select は判定に使う5列のみ。**body は取らない**
 * （感想本文は購入可否の判断に不要で、取らなければ取り違えて表示することもない）。
 * **rating も取らない**（§14 で購入条件から外した）。取ってこなければ、この場で
 * 閾値を書き足すこともできない。
 *
 * 見つからない・取得に失敗した場合は null を返す（呼び出し側で「購入不可」に倒す）。
 * reviewId はクライアント由来の値なので、**所有者確認は必ず判定側で行うこと**
 * （ここでは customer_id で絞らない。絞ると「他人の id を渡された」と
 *   「存在しない」の区別がつかなくなり、判定の分岐が書けない）。
 */
export async function loadReviewForPurchase(
  reviewId: string,
): Promise<PurchasableReviewRow | null> {
  const { data, error } = await supabaseAdmin
    .from("reviews")
    .select("id, customer_id, salon_id, staff_id, share_scope")
    .eq("id", reviewId)
    .maybeSingle();

  if (error) {
    // 取得できない＝購入不可に倒す。握り潰さずログだけ残す（review_id は秘匿値ではない）。
    console.error("[review-server] loadReviewForPurchase failed", {
      review_id: reviewId,
      code: error.code,
    });
    return null;
  }
  return (data as PurchasableReviewRow | null) ?? null;
}
