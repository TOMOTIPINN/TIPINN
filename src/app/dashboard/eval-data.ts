/**
 * 評価ダッシュボード（mock）の共有データ＆集計ロジック。
 * 上部の「店舗合計¥」（page.tsx）と「スタッフ別👍」（StaffPeriodView.tsx）が
 * 同じ期間フィルタ・同じ集計を使うため、ここに一元化する（ロジックを二重に持たない）。
 *
 * 法的ガード（厳守・原則5・6 / 金融庁回答の前提）:
 *  - ¥は「店舗合計（salon-total）」としてのみ集計・表示する。スタッフ個人には¥を割り付けない。
 *    （CLAUDE.md §2/§11 の「スタッフ単位に¥を出さない」ガードは維持・上書きしない）
 *  - スタッフ個人は「評価件数 / ティア内訳 / リアルボイス / 前期間比」のみ（§12）。
 *    個人別の¥・順位ポイント・加重スコアは出さない（¥÷100 等の金額の変装も禁止）。
 *  - 賞与の自動算出は行わない。これは判断材料の可視化であって賞与計算ツールではない。
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

// 各ティアの正規価格（¥）も rating-tiers.ts の単一ソースから引く（金額のハードコード禁止）。
// ★店舗合計の売上集計にのみ使う。スタッフ個人には割り付けない。
export const TIER_AMOUNT = Object.fromEntries(
  RATING_TIERS.map((t) => [t.label, t.amount]),
) as Record<Tier, number>;

// 集計対象スタッフ（役職つき・表示順を固定：店長→スタイリスト→アシスタント）。
export type StaffRole = "店長" | "スタイリスト" | "アシスタント";
export type StaffMember = { name: string; role: StaffRole };

export const STAFF_MEMBERS: StaffMember[] = [
  { name: "さがべぇ", role: "店長" },
  { name: "あゆむ", role: "スタイリスト" },
  { name: "テリ", role: "スタイリスト" },
  { name: "あかり", role: "スタイリスト" },
  { name: "拓馬", role: "スタイリスト" },
  { name: "原", role: "スタイリスト" },
  { name: "あみ", role: "アシスタント" },
  { name: "こゆき", role: "アシスタント" },
  { name: "まりあ", role: "アシスタント" },
];

// 集計のキー順（名前のみ）。役職は STAFF_ROLE で引く。
export const STAFF: string[] = STAFF_MEMBERS.map((m) => m.name);
export const STAFF_ROLE: Record<string, StaffRole> = Object.fromEntries(
  STAFF_MEMBERS.map((m) => [m.name, m.role]),
);

export type DummyEvent = {
  date: string; // ISO "YYYY-MM-DD"（文字列比較で期間判定できる形式）
  staff: string;
  type: "review" | "rating"; // 感想 / 評価スタンプ
  tier?: Tier; // type==="rating" のとき
  voice?: string; // 最近の一言（リアルボイス想定のダミー）
};

// ---- ダミーの日付付きイベント（本実装時にここを実クエリへ差し替える） ----
// 9人×3ヶ月ぶんを手書きすると崩れやすいので、スタッフ仕様（StaffSpec）から決定的に生成する。
// ★echo flow の好調/安定/要ケアは「件数トレンド」で決まる＝役職とは無関係（§12）。
//   下記 monthly（4月→5月→6月の評価件数）を役職をまたいで増減させ、ステータスを散らしている：
//     好調 ＝ あゆむ(スタイリスト)/あかり(スタイリスト)/あみ(アシスタント)
//     要ケア＝ テリ(スタイリスト)/こゆき(アシスタント)   ← 役職に偏らせない
//     安定 ＝ さがべぇ(店長)/拓馬/原/まりあ
// monthly＝各月の評価件数（感想＋評価スタンプ）。ratings＝そのうち評価スタンプ数（残りは感想）。
const MONTH_PREFIX = ["2026-04", "2026-05", "2026-06"]; // RECENT_MONTHS と対応（4/5/6月）

type StaffSpec = {
  name: string;
  monthly: [number, number, number]; // 評価件数（感想＋評価スタンプ）
  ratings: [number, number, number]; // うち評価スタンプ（≤ monthly）
  tierPool: Tier[]; // 評価スタンプに循環で割り当てるティア
  voice: string; // 直近（6月）のリアルボイス
};

const STAFF_SPECS: StaffSpec[] = [
  // 店長：安定
  {
    name: "さがべぇ",
    monthly: [3, 4, 4],
    ratings: [1, 2, 2],
    tierPool: ["Grateful", "Wonderful", "Amazing"],
    voice: "お店全体に目を配ってくれて、いつも安心して任せられます",
  },
  // スタイリスト：好調
  {
    name: "あゆむ",
    monthly: [4, 5, 6],
    ratings: [2, 2, 3],
    tierPool: ["Wonderful", "Amazing", "Grateful"],
    voice: "なりたい髪型をいつも的確に形にしてくれます",
  },
  // スタイリスト：要ケア（4→5→6月で減少）
  {
    name: "テリ",
    monthly: [6, 4, 3],
    ratings: [3, 2, 1],
    tierPool: ["Grateful", "Wonderful", "Thank you"],
    voice: "施術はていねいでした。また様子を見て伺いますね",
  },
  // スタイリスト：好調
  {
    name: "あかり",
    monthly: [3, 4, 5],
    ratings: [1, 2, 2],
    tierPool: ["Thank you", "Grateful", "Wonderful"],
    voice: "カウンセリングがていねいで、要望をしっかり汲んでくれました",
  },
  // スタイリスト：安定
  {
    name: "拓馬",
    monthly: [4, 4, 4],
    ratings: [2, 2, 2],
    tierPool: ["Grateful", "Wonderful", "Thank you"],
    voice: "落ち着いた接客で、毎回安定の仕上がりです",
  },
  // スタイリスト：安定
  {
    name: "原",
    monthly: [5, 5, 4],
    ratings: [2, 2, 2],
    tierPool: ["Wonderful", "Grateful", "Amazing"],
    voice: "技術が高くて、難しい注文にもきちんと応えてくれました",
  },
  // アシスタント：好調（1→2→4件と伸びている）
  {
    name: "あみ",
    monthly: [1, 2, 4],
    ratings: [0, 1, 2],
    tierPool: ["Thank you", "Grateful"],
    voice: "シャンプーがとても気持ちよくて、つい眠ってしまいました",
  },
  // アシスタント：要ケア（4→3→2月で減少）
  {
    name: "こゆき",
    monthly: [4, 3, 2],
    ratings: [2, 1, 1],
    tierPool: ["Grateful", "Thank you", "Wonderful"],
    voice: "笑顔の対応はうれしいです。最近は少し慌ただしそうでした",
  },
  // アシスタント：安定
  {
    name: "まりあ",
    monthly: [2, 3, 3],
    ratings: [1, 1, 2],
    tierPool: ["Thank you", "Grateful", "Wonderful"],
    voice: "細やかな気配りがうれしくて、また指名したいと思いました",
  },
];

// 月内の日付を 1〜28 に均等配置（月末はみ出し回避・決定的：Date.now/randomは使わない）。
function dayOf(index: number, total: number): string {
  const d = Math.max(1, Math.min(28, Math.round(((index + 1) * 28) / (total + 1))));
  return String(d).padStart(2, "0");
}

// StaffSpec から決定的にイベント列を生成（各月：先頭 ratings 件を評価スタンプ、残りを感想）。
function buildEvents(specs: StaffSpec[]): DummyEvent[] {
  const out: DummyEvent[] = [];
  for (const sp of specs) {
    for (let mi = 0; mi < MONTH_PREFIX.length; mi++) {
      const total = sp.monthly[mi];
      const ratings = sp.ratings[mi];
      let tierIdx = 0;
      for (let i = 0; i < total; i++) {
        const date = `${MONTH_PREFIX[mi]}-${dayOf(i, total)}`;
        out.push(
          i < ratings
            ? {
                date,
                staff: sp.name,
                type: "rating",
                tier: sp.tierPool[tierIdx++ % sp.tierPool.length],
              }
            : { date, staff: sp.name, type: "review" },
        );
      }
      // 6月（最新月）の最後＝最新日付のイベントに直近ボイスを付与（日次・HRどちらも拾う）。
      if (mi === MONTH_PREFIX.length - 1 && total > 0) {
        out[out.length - 1].voice = sp.voice;
      }
    }
  }
  return out;
}

export const EVENTS: DummyEvent[] = buildEvents(STAFF_SPECS);
// --------------------------------------------------------------------

export type Range = { start: string; end: string };
export type PresetKey = "thisMonth" | "lastMonth" | "thisYear";

// プリセット期間（基準日 2026-06-19）。cur＝対象期間 / prev＝前期間（トレンド比較）。
export const PRESETS: Record<
  PresetKey,
  { label: string; cur: Range; prev: Range }
> = {
  thisMonth: {
    label: "今月",
    cur: { start: "2026-06-01", end: "2026-06-30" },
    prev: { start: "2026-05-01", end: "2026-05-31" },
  },
  lastMonth: {
    label: "先月",
    cur: { start: "2026-05-01", end: "2026-05-31" },
    prev: { start: "2026-04-01", end: "2026-04-30" },
  },
  thisYear: {
    label: "今年",
    cur: { start: "2026-01-01", end: "2026-12-31" },
    prev: { start: "2025-01-01", end: "2025-12-31" },
  },
};

// 直近3ヶ月（基準日 2026-06-19・mock）。echo flow（月次トレンド）の集計窓。
// ★本実装時は基準日を「今日」から算出して直近Nヶ月を動的に作る（ここは固定のダミー）。
export const RECENT_MONTHS: { key: string; label: string; start: string; end: string }[] = [
  { key: "2026-04", label: "4月", start: "2026-04-01", end: "2026-04-30" },
  { key: "2026-05", label: "5月", start: "2026-05-01", end: "2026-05-31" },
  { key: "2026-06", label: "6月", start: "2026-06-01", end: "2026-06-30" },
];

const DAY_MS = 86_400_000;

function isoOf(d: Date): string {
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

// カスタム期間の「直前・同じ長さ」の前期間を求める（トレンド比較用）。
export function precedingRange(r: Range): Range {
  const s = new Date(r.start + "T00:00:00");
  const e = new Date(r.end + "T00:00:00");
  const len = e.getTime() - s.getTime();
  const prevEnd = new Date(s.getTime() - DAY_MS);
  const prevStart = new Date(prevEnd.getTime() - len);
  return { start: isoOf(prevStart), end: isoOf(prevEnd) };
}

// モード（プリセット/カスタム）→ 対象期間・前期間・ラベルを解決。
// page.tsx と StaffPeriodView.tsx が同じ結果を使えるよう一元化。
export function resolveRange(
  mode: PresetKey | "custom",
  custom: Range,
): { range: Range; prevRange: Range; label: string } {
  if (mode === "custom") {
    return {
      range: custom,
      prevRange: precedingRange(custom),
      label: `${custom.start} 〜 ${custom.end}`,
    };
  }
  const p = PRESETS[mode];
  return { range: p.cur, prevRange: p.prev, label: p.label };
}

export type StaffAgg = {
  reviews: number; // 感想数
  ratings: number; // 評価スタンプ数（件数）
  revenue: number; // ティア正規価格の合計（★店舗合計の集計用のみ・個人には表示しない）
  tiers: Record<Tier, number>; // ティア別の内訳（件数）
  voice: string | null; // 最近の一言（期間内・最新）
};

function emptyTiers(): Record<Tier, number> {
  return {
    "Thank you": 0,
    Grateful: 0,
    Wonderful: 0,
    Amazing: 0,
    Unforgettable: 0,
  };
}

// 指定期間で全イベントをスタッフ別に集計（クライアント側・文字列日付比較）。
export function aggregate(range: Range): Record<string, StaffAgg> {
  const out: Record<string, StaffAgg> = {};
  for (const name of STAFF) {
    out[name] = {
      reviews: 0,
      ratings: 0,
      revenue: 0,
      tiers: emptyTiers(),
      voice: null,
    };
  }
  // 期間内で最新の voice を採用するため、スタッフごとに採用済み日付を覚えておく。
  const latestVoiceDate: Record<string, string> = {};
  for (const ev of EVENTS) {
    if (ev.date < range.start || ev.date > range.end) continue;
    const agg = out[ev.staff];
    if (!agg) continue;
    if (ev.type === "review") agg.reviews += 1;
    else {
      agg.ratings += 1;
      if (ev.tier) {
        agg.tiers[ev.tier] += 1;
        // revenue は店舗合計の集計用にのみ加算（個人には出さない）。
        agg.revenue += TIER_AMOUNT[ev.tier];
      }
    }
    if (ev.voice && (!latestVoiceDate[ev.staff] || ev.date >= latestVoiceDate[ev.staff])) {
      latestVoiceDate[ev.staff] = ev.date;
      agg.voice = ev.voice;
    }
  }
  return out;
}

// 店舗合計の評価スタンプ売上（¥）。全スタッフ分のティア正規価格合計＝店舗の売上。
// ★個人には割り付けない（原則5）。先行指標エリアでの店舗合計表示にのみ使う。
export function salonRevenue(map: Record<string, StaffAgg>): number {
  return STAFF.reduce((sum, n) => sum + (map[n]?.revenue ?? 0), 0);
}

// 期間内の評価件数の合計（感想＋評価スタンプ・全スタッフ）。
// ★スタッフ別ビューの各行（感想＋評価スタンプ）と同一ソース＝合計が一致する。
export function totalCount(map: Record<string, StaffAgg>): number {
  return STAFF.reduce(
    (sum, n) => sum + (map[n]?.reviews ?? 0) + (map[n]?.ratings ?? 0),
    0,
  );
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

// ============================================================
// echo flow（HR月次ビューの中核指標・§12）
// 定義: そのスタッフに月次で「届いた評価の流れ」＝感想＋評価スタンプの件数（＝承認が届いた回数）。
//       ¥でも順位スコアでもない非金銭の件数指標（既存 trendText の「総アクティビティ」と同義）。
// 判定: 増減の「傾向」だけで見る。絶対件数の閾値は使わない（若手＝低件数を不利にしないため）。
//  - 要ケア＝直近2ヶ月連続で前月比マイナス（承認が届かなくなってきた＝離職予兆）
//  - 好調  ＝直近が前月比プラス
//  - 安定  ＝それ以外（横ばい等）
// ============================================================
export type FlowStatus = "good" | "stable" | "care";

export type StaffFlow = {
  staff: string;
  counts: number[]; // RECENT_MONTHS と同順の月次評価件数（感想＋評価スタンプ）
  status: FlowStatus;
  voice: string | null; // 直近3ヶ月で最新のリアルボイス（生のまま表示）
};

// 月次件数列からステータスを判定（増減の傾向のみ・絶対値は見ない）。
export function flowStatus(counts: number[]): FlowStatus {
  const n = counts.length;
  if (n < 2) return "stable";
  const d2 = counts[n - 1] - counts[n - 2]; // 直近の前月比
  const d1 = n >= 3 ? counts[n - 2] - counts[n - 3] : 0; // その前の前月比
  if (d2 < 0 && d1 < 0) return "care"; // 2ヶ月連続マイナス
  if (d2 > 0) return "good"; // 直近が増加
  return "stable";
}

// 全スタッフの echo flow（直近3ヶ月の月次件数＋ステータス＋最新ボイス）を集計。
// ★既存 aggregate を月ごとに呼ぶだけ（集計ロジックを二重に持たない）。本実装時は実クエリへ。
export function echoFlow(): StaffFlow[] {
  const monthly = RECENT_MONTHS.map((m) => aggregate({ start: m.start, end: m.end }));
  const span = {
    start: RECENT_MONTHS[0].start,
    end: RECENT_MONTHS[RECENT_MONTHS.length - 1].end,
  };
  const spanAgg = aggregate(span);
  return STAFF.map((staff) => {
    const counts = monthly.map((agg) => agg[staff].reviews + agg[staff].ratings);
    return {
      staff,
      counts,
      status: flowStatus(counts),
      voice: spanAgg[staff]?.voice ?? null,
    };
  });
}

// 前期間比トレンド（総アクティビティ＝感想＋評価の件数で比較）。矢印で方向を示し、色は§12で付す。
export function trendText(prev: number, cur: number): string {
  if (prev === 0 && cur === 0) return "—";
  if (prev === 0) return "新規 +" + cur;
  const d = Math.round(((cur - prev) / prev) * 100);
  const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "→";
  return `${arrow} ${d >= 0 ? "+" : ""}${d}%（前期間比）`;
}
