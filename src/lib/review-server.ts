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
