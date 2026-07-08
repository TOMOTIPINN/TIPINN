/**
 * 感想（reviews）のサーバー専用ヘルパー（supabaseAdmin 依存・RLS deny-by-default / CLAUDE.md §8）。
 *
 * lib/review.ts はクライアントと共有する純粋モジュールなので、DB アクセスはここに分離する
 * （supabaseAdmin をクライアントバンドルに巻き込まない）。
 *
 * 「1来店＝1顧客/1サロン/JST日 につき感想1回」の重複制限の UX ベルト（ページロード時の既送信判定）。
 * 本当の砦は RPC submit_review_and_earn_stamp（0020・advisory lock 内で判定）。ここは表示の出し分け用。
 */
import { supabaseAdmin } from "@/lib/supabase-admin";
import { jstPeriodStartISO } from "@/lib/staff-stats";

/**
 * 今日(JST)この(顧客,サロン)に既に感想を送っているか。
 * 判定単位は RPC/スタンプの「1個/顧客/サロン/日(JST)」と同一（staff は問わない）。
 * created_at >= JST今日0時 で数える（jstPeriodStartISO は UTC-ISO を返す＝timestamptz にそのまま比較可）。
 */
export async function hasReviewedToday(
  customerId: string,
  salonId: string,
): Promise<boolean> {
  const todayStart = jstPeriodStartISO("today");
  const { count } = await supabaseAdmin
    .from("reviews")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .eq("salon_id", salonId)
    .gte("created_at", todayStart);

  return (count ?? 0) > 0;
}
