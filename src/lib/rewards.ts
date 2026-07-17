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
  is_consumable: boolean;
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
  is_consumable: boolean;
}): SalonReward {
  return {
    id: row.id,
    salon_id: row.salon_id,
    reward_type: toRewardType(row.reward_type),
    title: row.title,
    required_count: row.required_count,
    is_consumable: row.is_consumable === true,
  };
}

/**
 * 1サロンの特典一覧（最大2件・作成順）。/manager/rewards・/review/complete（単一サロン）用。
 */
export async function getSalonRewards(salonId: string): Promise<SalonReward[]> {
  const { data } = await supabaseAdmin
    .from("rewards")
    .select("id, salon_id, reward_type, title, required_count, is_consumable")
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
    .select("id, salon_id, reward_type, title, required_count, is_consumable")
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

/**
 * 消費型特典の使用状態（is_consumable=true のみ・migration 0029 の RPC 経由）。
 *  ・"available" … まだ使える（earned_count > redeemed_count）
 *  ・"used"      … 獲得ぶんを使い切った（earned_count > 0 かつ earned == redeemed）
 * 未獲得（earned_count == 0）はどちらでもない＝Map に入れない（mypage は基本の✓ゴール表示に落とす）。
 * 状態型（is_consumable=false）はそもそも RPC が行を返さない＝常に不在＝常時✓。
 *
 * ⚠️ earned_count - redeemed_count（あと何回分か）は UI に出さない。RPC が count を返すのは
 *    available 判定に必要だからで、回数表示のためではない（2026-07-16 決定）。ここでも boolean 判定にしか使わない。
 */
export type ConsumableRewardState = "available" | "used";

/**
 * 複数サロンの消費型特典の使用状態をまとめて取得（/mypage 用・N+1回避）。
 * 返り値は salon_id → (reward_id → 状態)。状態が付く消費型が無い salon はキー自体が無い。
 *
 * RPC list_consumable_reward_states は (customer_id, salon_id) の1組しか取らないため、
 * salonId をループして Promise.all で並列に叩く（全サロン一括版の SQL は作らない＝SQLは人間側管理）。
 * service_role・サーバー側のみ（RLS deny-by-default・§8）。1サロン失敗は console.error で握り潰し、
 * その salon は状態なし（基本の✓）に落とす＝特典表示の欠落は機会損失だが mypage 全体は壊さない。
 */
export async function getConsumableRewardStatesMap(
  customerId: string,
  salonIds: string[],
): Promise<Map<string, Map<string, ConsumableRewardState>>> {
  const map = new Map<string, Map<string, ConsumableRewardState>>();
  const ids = Array.from(new Set(salonIds)).filter(Boolean);
  if (ids.length === 0) return map;

  const results = await Promise.all(
    ids.map(async (salonId) => {
      const { data, error } = await supabaseAdmin.rpc(
        "list_consumable_reward_states",
        { p_customer_id: customerId, p_salon_id: salonId },
      );
      if (error) {
        console.error("list_consumable_reward_states failed:", error);
        return { salonId, rows: [] as ConsumableStateRow[] };
      }
      return { salonId, rows: (data ?? []) as ConsumableStateRow[] };
    }),
  );

  for (const { salonId, rows } of results) {
    const inner = new Map<string, ConsumableRewardState>();
    for (const row of rows) {
      // 未獲得（earned==0）は状態を付けない＝基本の✓ゴール表示のまま（「使用済み」と誤表示しない）。
      if (row.earned_count <= 0) continue;
      inner.set(
        row.reward_id,
        row.earned_count > row.redeemed_count ? "available" : "used",
      );
    }
    if (inner.size > 0) map.set(salonId, inner);
  }
  return map;
}

type ConsumableStateRow = {
  reward_id: string;
  title: string;
  earned_count: number;
  redeemed_count: number;
};
