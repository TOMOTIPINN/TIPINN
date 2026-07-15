import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * 来店スタンプ移行台帳（stamp_adjustments）の読み取り（Phase 7・migration 0019）。
 *
 * 累計来店の定義を  COUNT(visits) + COALESCE(SUM(stamp_adjustments.delta),0)  の1式に一本化するための
 * app側の単一ソース（SQL側は submit_visit_and_earn_stamp / 0019 が同じ式で担保）。
 * source='migration' のみを対象にする。unique(customer_id, salon_id, source) のため1ペア最大1行。
 *
 * 全クエリは service_role でサーバー側のみ（RLS deny-by-default・CLAUDE.md §8）。書き込みは API 側。
 */

export type MigrationEntry = { id: string; delta: number; createdAt: string };

/** 単一 (顧客, サロン) の移行行。未存在は null（＝未移行。入力欄の表示ゲートに使う）。
 *  created_at ＝初回移行時刻（訂正は UPDATE なので不変・0019）。移行後 visit 数の基準に使う。 */
export async function getMigrationEntry(
  customerId: string,
  salonId: string,
): Promise<MigrationEntry | null> {
  const { data } = await supabaseAdmin
    .from("stamp_adjustments")
    .select("id, delta, created_at")
    .eq("customer_id", customerId)
    .eq("salon_id", salonId)
    .eq("source", "migration")
    .maybeSingle<{ id: string; delta: number | null; created_at: string }>();

  return data
    ? { id: data.id, delta: data.delta ?? 0, createdAt: data.created_at }
    : null;
}

/**
 * 顧客の全サロン分の移行オフセット（source='migration' の salon_id → 合算delta）。/mypage 用・N+1回避。
 * mypage は wave1 で salon_id 群が未確定なため、顧客キーで全件取得して和集合の候補にも使う。
 * 移行の無い salon はキー自体が無い（呼び出し側で ?? 0）。
 */
export async function getCustomerMigrationDeltas(
  customerId: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();

  const { data } = await supabaseAdmin
    .from("stamp_adjustments")
    .select("salon_id, delta")
    .eq("customer_id", customerId)
    .eq("source", "migration");

  for (const row of (data ?? []) as { salon_id: string; delta: number | null }[]) {
    map.set(row.salon_id, (map.get(row.salon_id) ?? 0) + (row.delta ?? 0));
  }
  return map;
}
