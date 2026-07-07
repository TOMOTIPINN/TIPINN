/**
 * ダッシュボードの共有「型 ＆ 純粋ヘルパー」（旧: mock データ層）。
 *
 * 実データ集計は dashboard-data.ts（server / supabaseAdmin）が担い、ここは DB 非依存の
 * 型・定数・純粋関数だけを持つ。DashboardClient / StaffPeriodView / HrFlowView が共有する。
 *
 * 法的ガード（§12・原則5/6）: ¥は「店舗合計」としてのみ集計・表示（個人に割り付けない）。
 *   スタッフ個人は件数・ティア内訳・ボイス・前期間比のみ。賞与は購入と機械的に連動しない。
 */
import { RATING_TIERS } from "@/lib/rating-tiers";

export type Tier =
  | "Thank you"
  | "Grateful"
  | "Wonderful"
  | "Amazing"
  | "Unforgettable";

// ティア表示順（CLAUDE.md §6 の価格順）。
export const TIER_ORDER: Tier[] = [
  "Thank you",
  "Grateful",
  "Wonderful",
  "Amazing",
  "Unforgettable",
];

// 各ティアの絵文字は rating-tiers.ts（単一ソース）から引く。内訳チップで使用。
export const TIER_EMOJI = Object.fromEntries(
  RATING_TIERS.map((t) => [t.label, t.emoji]),
) as Record<Tier, string>;

// スタッフ別の期間集計（1スタッフ分）。
export type StaffAgg = {
  reviews: number; // 感想数
  ratings: number; // 評価スタンプ数（件数）
  revenue: number; // ★店舗集計専用。per-staff は常に 0 で client へ渡す（原則5・個人¥を漏らさない）
  tiers: Record<Tier, number>; // ティア別内訳（件数）
  voice: string | null; // 期間内で最新のリアルボイス（reviews.body）
};

export function emptyTiers(): Record<Tier, number> {
  return {
    "Thank you": 0,
    Grateful: 0,
    Wonderful: 0,
    Amazing: 0,
    Unforgettable: 0,
  };
}

// echo flow（HR月次ビューの中核指標・§12）。届いた評価の月次件数トレンド（非金銭）。
export type FlowStatus = "good" | "stable" | "care";
export type StaffFlow = {
  staff: string;
  counts: number[]; // 直近Nヶ月と同順の月次評価件数（感想＋評価スタンプ）
  status: FlowStatus;
  voice: string | null; // 直近スパンで最新のリアルボイス
  archived: boolean; // 退職者（グレー表示＋要ケア判定から除外）
};

// 月次件数列からステータスを判定（増減の傾向のみ・絶対値は見ない・§12）。
//  要ケア＝直近2ヶ月連続マイナス / 好調＝直近プラス / 安定＝それ以外。
export function flowStatus(counts: number[]): FlowStatus {
  const n = counts.length;
  if (n < 2) return "stable";
  const d2 = counts[n - 1] - counts[n - 2]; // 直近の前月比
  const d1 = n >= 3 ? counts[n - 2] - counts[n - 3] : 0; // その前の前月比
  if (d2 < 0 && d1 < 0) return "care";
  if (d2 > 0) return "good";
  return "stable";
}

// 桁区切り（ロケール非依存・SSR/CSRで一致させる）。
export function yen(n: number): string {
  return "¥" + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// 前期間比の方向（上昇/横ばい/下降）。色分け（§12: 上昇＝ミント / それ以外＝グレー）に使う。
export function trendDir(prev: number, cur: number): "up" | "flat" | "down" {
  if (cur > prev) return "up";
  if (cur < prev) return "down";
  return "flat";
}

// 前期間比トレンド文（総アクティビティ＝感想＋評価の件数で比較）。矢印は方向・色は§12で付す。
export function trendText(prev: number, cur: number): string {
  if (prev === 0 && cur === 0) return "—";
  if (prev === 0) return "新規 +" + cur;
  const d = Math.round(((cur - prev) / prev) * 100);
  const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "→";
  return `${arrow} ${d >= 0 ? "+" : ""}${d}%（前期間比）`;
}
