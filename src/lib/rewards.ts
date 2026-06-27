import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * VIP特典（rewards）の読み取り＆型定義（Phase 6-A・CLAUDE.md §4 / migration 0008）。
 *
 * 貯まるスタンプのVIP特典は salon ごとに最大2件まで設定でき、VIPサイクル到達（既定3個）で
 * その2件が「セット付与」される（はしご型はやらない＝全行 同じ required_count で並ぶ前提）。
 *
 * - 「型」reward_type は3値固定（migration 0008 の CHECK と一致）。金額/割引率は持たない（換金性排除・§2）。
 * - 件数上限・同一 required_count はアプリ側で担保（DBは値域のみ制約）。MAX_REWARDS をAPI/画面で使う。
 * - VIPバッジ（echo標準・全サロン共通）は rewards とは別物。ここでは扱わない。
 *
 * 全クエリは service_role でサーバー側のみ（RLS deny-by-default・CLAUDE.md §8）。
 */

/** reward_type の値域（migration 0008 の CHECK と一致させる唯一の正）。 */
export const REWARD_TYPE = ["discount", "service", "priority"] as const;
export type RewardType = (typeof REWARD_TYPE)[number];

/** お客様・店長向けの日本語ラベル（§5 トーン）。 */
export const REWARD_TYPE_LABEL: Record<RewardType, string> = {
  discount: "割引",
  service: "サービス",
  priority: "優先",
};

/** サロンが設定できる特典の上限（Phase 6-A 確定・DBではなくアプリで担保）。 */
export const MAX_REWARDS = 2;

export type SalonReward = {
  id: string;
  salon_id: string;
  reward_type: RewardType;
  title: string;
  required_count: number;
};

/** 不正な型混入に備えてガード（DB CHECK 済みだが純粋に正規化する）。 */
function toRewardType(value: unknown): RewardType {
  return REWARD_TYPE.includes(value as RewardType)
    ? (value as RewardType)
    : "service";
}

function normalize(row: {
  id: string;
  salon_id: string;
  reward_type: string;
  title: string;
  required_count: number;
}): SalonReward {
  return {
    id: row.id,
    salon_id: row.salon_id,
    reward_type: toRewardType(row.reward_type),
    title: row.title,
    required_count: row.required_count,
  };
}

/**
 * 1サロンの特典一覧（最大2件・作成順）。/manager/rewards・/review/complete（単一サロン）用。
 */
export async function getSalonRewards(salonId: string): Promise<SalonReward[]> {
  const { data } = await supabaseAdmin
    .from("rewards")
    .select("id, salon_id, reward_type, title, required_count")
    .eq("salon_id", salonId)
    .order("created_at", { ascending: true });

  return (data ?? []).map(normalize);
}

/**
 * 複数サロンの特典をまとめて取得（/mypage 用・N+1回避）。
 * 返り値は salon_id → その特典配列（作成順）。特典未設定の salon はキー自体が無い。
 */
export async function getSalonRewardsMap(
  salonIds: string[],
): Promise<Map<string, SalonReward[]>> {
  const map = new Map<string, SalonReward[]>();
  const ids = Array.from(new Set(salonIds)).filter(Boolean);
  if (ids.length === 0) return map;

  const { data } = await supabaseAdmin
    .from("rewards")
    .select("id, salon_id, reward_type, title, required_count")
    .in("salon_id", ids)
    .order("created_at", { ascending: true });

  for (const row of data ?? []) {
    const r = normalize(row);
    const list = map.get(r.salon_id);
    if (list) list.push(r);
    else map.set(r.salon_id, [r]);
  }
  return map;
}
