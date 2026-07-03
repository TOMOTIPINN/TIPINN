/**
 * ダッシュボードの実データ集計層（server専用・supabaseAdmin）。
 *
 * getDashboardData(salonId, periodStart, periodEnd) 一本で、日次ビュー（スタッフ別・店舗合計・
 * VIP・ティア内訳・最近の評価）と HR月次ビュー（echo flow）に必要な集計をまとめて返す。
 * 返す型は eval-data.ts（共有・純粋）に揃え、client 側の描画JSXを変えずに差し替える。
 *
 * スコープ・法的ガード（§12・原則5/6/7）:
 *  - すべて salon_id でスコープ（越境しない）。
 *  - ¥は「店舗合計（rating_purchases.amount 合計）」のみ。per-staff の ¥ は client に一切出さない
 *    （StaffAgg.revenue は常に 0 で返す）。
 *  - 顧客名は VIP 一覧のみ（レジ判別補助・原則7）。最近の評価には顧客名を含めない。
 *
 * 日付基準（JST / Asia/Tokyo）:
 *  - reviews / rating_purchases は created_at（timestamptz）。JST境界の ISO で範囲比較する
 *    （periodStart/periodEnd は jstPeriodStartISO 由来の UTC-ISO を想定）。
 *  - echo flow は periodEnd を含む JST 暦月から遡る直近3ヶ月でバケット化する。
 *  - 現在の期間は「今月」固定運用だが、引数で任意期間に対応できる形にしてある（期間UIは後日配線）。
 */
import { supabaseAdmin } from "@/lib/supabase-admin";
import { RATING_TIERS } from "@/lib/rating-tiers";
import { computeVipProgress } from "@/lib/vip";
import {
  TIER_ORDER,
  emptyTiers,
  flowStatus,
  type Tier,
  type StaffAgg,
  type StaffFlow,
} from "./eval-data";

/** JST は UTC+9 固定（サマータイム無し）。 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// tier slug（DB）→ 表示ラベル。金額は DB 行の amount を正とする（RATING_TIERS はラベル解決に使用）。
const SLUG_TO_LABEL: Record<string, Tier> = Object.fromEntries(
  RATING_TIERS.map((t) => [t.tier, t.label as Tier]),
);

// 最近の評価の時刻表示（JST・HH:MM）。
const jstTime = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export type RecentEval = { time: string; staff: string; tier: Tier };
export type VipCustomer = { name: string; stampCount: number; voice: string | null };

export type DashboardData = {
  salonName: string;
  label: string;
  staffNames: string[];
  staffRole: Record<string, string>;
  cur: Record<string, StaffAgg>;
  prev: Record<string, StaffAgg>;
  salonRevenueCur: number;
  salonRevenuePrev: number;
  totalCountCur: number;
  totalCountPrev: number;
  tierBreakdown: { label: Tier; count: number }[];
  recent: RecentEval[];
  vipCustomers: VipCustomer[];
  vipTotal: number;
  flows: StaffFlow[];
  monthLabels: string[];
};

type ReviewRow = {
  staff_id: string | null;
  customer_id: string;
  body: string;
  share_scope: string | null;
  created_at: string;
};
type RatingRow = {
  staff_id: string | null;
  tier: string;
  amount: number;
  created_at: string;
};
type StaffRow = {
  id: string;
  name: string;
  role: string;
  job_title: string | null;
};
type StampRow = { customer_id: string; count: number | null };

// monthsBack ヶ月前の「JST 月初 0:00」を UTC ミリ秒で返す。
function jstMonthStartMs(nowMs: number, monthsBack: number): number {
  const d = new Date(nowMs + JST_OFFSET_MS);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - monthsBack);
  return d.getTime() - JST_OFFSET_MS;
}
// UTC ミリ秒 → JST 月キー "YYYY-MM"。
function jstMonthKey(ms: number): string {
  const d = new Date(ms + JST_OFFSET_MS);
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}

export async function getDashboardData(
  salonId: string,
  periodStart: string,
  periodEnd: string,
): Promise<DashboardData> {
  const nowMs = Date.now();
  const curStartMs = Date.parse(periodStart);
  const curEndMs = Date.parse(periodEnd);
  const curLen = Math.max(0, curEndMs - curStartMs);
  // 前期間＝直前・同じ長さの窓（前期間比トレンド用）。
  const prevEndMs = curStartMs;
  const prevStartMs = curStartMs - curLen;

  // echo flow の直近3ヶ月（JST暦月）。取得スパンは 3ヶ月・当期・前期を包む最小の開始点。
  const monthKeys = [2, 1, 0].map((b) => jstMonthKey(jstMonthStartMs(nowMs, b)));
  const monthLabels = monthKeys.map((k) => String(Number(k.slice(5))) + "月");
  const flowStartMs = jstMonthStartMs(nowMs, 2);
  const spanStartISO = new Date(Math.min(flowStartMs, prevStartMs)).toISOString();

  // ---- wave 1: salon 名 / staff / スパン内 reviews・ratings / earned_stamps ----
  const [salonRes, staffRes, reviewRes, ratingRes, stampRes] = await Promise.all([
    supabaseAdmin.from("salons").select("name").eq("id", salonId).single(),
    supabaseAdmin
      .from("staff")
      .select("id, name, role, job_title")
      .eq("salon_id", salonId)
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("reviews")
      .select("staff_id, customer_id, body, share_scope, created_at")
      .eq("salon_id", salonId)
      .gte("created_at", spanStartISO),
    supabaseAdmin
      .from("rating_purchases")
      .select("staff_id, tier, amount, created_at")
      .eq("salon_id", salonId)
      .gte("created_at", spanStartISO),
    supabaseAdmin
      .from("earned_stamps")
      .select("customer_id, count")
      .eq("salon_id", salonId),
  ]);

  const staff = (staffRes.data ?? []) as StaffRow[];
  const reviews = (reviewRes.data ?? []) as ReviewRow[];
  const ratings = (ratingRes.data ?? []) as RatingRow[];
  const stamps = (stampRes.data ?? []) as StampRow[];

  const staffNames = staff.map((s) => s.name);
  const staffRole: Record<string, string> = {};
  const idToName = new Map<string, string>();
  for (const s of staff) {
    // 役職タグは job_title（自由文）を採用。無ければ role からフォールバック。
    staffRole[s.name] = s.job_title || (s.role === "manager" ? "店長" : "スタッフ");
    idToName.set(s.id, s.name);
  }

  const inWindow = (ms: number, startMs: number, endMs: number) =>
    ms >= startMs && ms < endMs;

  // スタッフ別集計（staff_id 別。null＝サロン全体宛は per-staff からは除外＝帰属不能のため）。
  function buildAgg(startMs: number, endMs: number): Record<string, StaffAgg> {
    const out: Record<string, StaffAgg> = {};
    for (const name of staffNames) {
      out[name] = { reviews: 0, ratings: 0, revenue: 0, tiers: emptyTiers(), voice: null };
    }
    const latestVoiceMs: Record<string, number> = {};
    for (const r of reviews) {
      const t = Date.parse(r.created_at);
      if (!inWindow(t, startMs, endMs)) continue;
      const name = r.staff_id ? idToName.get(r.staff_id) : undefined;
      if (!name || !out[name]) continue;
      out[name].reviews += 1;
      // 本画面は manager 専用ガード済＝全 share_scope 閲覧可。voice は最新の body を採用。
      if (!latestVoiceMs[name] || t >= latestVoiceMs[name]) {
        latestVoiceMs[name] = t;
        out[name].voice = r.body;
      }
    }
    for (const rp of ratings) {
      const t = Date.parse(rp.created_at);
      if (!inWindow(t, startMs, endMs)) continue;
      const name = rp.staff_id ? idToName.get(rp.staff_id) : undefined;
      if (!name || !out[name]) continue;
      out[name].ratings += 1;
      const label = SLUG_TO_LABEL[rp.tier];
      if (label) out[name].tiers[label] += 1;
      // ★per-staff の revenue は client に出さない（原則5）＝ 0 のまま。
    }
    return out;
  }

  const cur = buildAgg(curStartMs, curEndMs);
  const prev = buildAgg(prevStartMs, prevEndMs);

  // 店舗合計（全行・null staff 含む＝総件数を正確に）。¥は amount 合計。
  function salonTotals(startMs: number, endMs: number) {
    let count = 0;
    let revenue = 0;
    for (const r of reviews) {
      if (inWindow(Date.parse(r.created_at), startMs, endMs)) count += 1;
    }
    for (const rp of ratings) {
      if (inWindow(Date.parse(rp.created_at), startMs, endMs)) {
        count += 1;
        revenue += rp.amount;
      }
    }
    return { count, revenue };
  }
  const curTot = salonTotals(curStartMs, curEndMs);
  const prevTot = salonTotals(prevStartMs, prevEndMs);

  // ティア内訳（当期・店舗全体）。
  const breakdown = emptyTiers();
  for (const rp of ratings) {
    if (!inWindow(Date.parse(rp.created_at), curStartMs, curEndMs)) continue;
    const label = SLUG_TO_LABEL[rp.tier];
    if (label) breakdown[label] += 1;
  }
  const tierBreakdown = TIER_ORDER.map((label) => ({ label, count: breakdown[label] }));

  // 最近の評価（当期・最新5件・顧客名は含めない＝原則7）。
  const recent: RecentEval[] = ratings
    .filter((rp) => inWindow(Date.parse(rp.created_at), curStartMs, curEndMs))
    .filter((rp) => SLUG_TO_LABEL[rp.tier])
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 5)
    .map((rp) => ({
      time: jstTime.format(new Date(rp.created_at)),
      staff: (rp.staff_id && idToName.get(rp.staff_id)) || "サロン全体",
      tier: SLUG_TO_LABEL[rp.tier],
    }));

  // echo flow（直近3ヶ月・月次件数＝感想＋評価スタンプ）。
  const flowCounts: Record<string, number[]> = {};
  const flowVoiceMs: Record<string, number> = {};
  const flowVoice: Record<string, string | null> = {};
  for (const name of staffNames) {
    flowCounts[name] = [0, 0, 0];
    flowVoice[name] = null;
  }
  const keyIndex = new Map(monthKeys.map((k, i) => [k, i]));
  for (const r of reviews) {
    const name = r.staff_id ? idToName.get(r.staff_id) : undefined;
    if (!name || !flowCounts[name]) continue;
    const ms = Date.parse(r.created_at);
    const idx = keyIndex.get(jstMonthKey(ms));
    if (idx !== undefined) flowCounts[name][idx] += 1;
    if (!flowVoiceMs[name] || ms >= flowVoiceMs[name]) {
      flowVoiceMs[name] = ms;
      flowVoice[name] = r.body;
    }
  }
  for (const rp of ratings) {
    const name = rp.staff_id ? idToName.get(rp.staff_id) : undefined;
    if (!name || !flowCounts[name]) continue;
    const idx = keyIndex.get(jstMonthKey(Date.parse(rp.created_at)));
    if (idx !== undefined) flowCounts[name][idx] += 1;
  }
  const flows: StaffFlow[] = staffNames.map((name) => ({
    staff: name,
    counts: flowCounts[name],
    status: flowStatus(flowCounts[name]),
    voice: flowVoice[name],
  }));

  // VIP（earned_stamps を salon スコープで集計）。VIP判定は computeVipProgress（単一ソース）。
  const vipRows = stamps
    .map((s) => ({ customer_id: s.customer_id, count: s.count ?? 0 }))
    .filter((s) => computeVipProgress(s.count).isVIP);
  const vipTotal = vipRows.length;
  const vipTop = [...vipRows].sort((a, b) => b.count - a.count).slice(0, 6);
  const vipIds = new Set(vipTop.map((v) => v.customer_id));

  // wave 2: VIP の表示名（原則7の例外＝レジ判別補助）。
  const nameById = new Map<string, string>();
  if (vipTop.length) {
    const { data: custData } = await supabaseAdmin
      .from("customers")
      .select("id, display_name")
      .in("id", [...vipIds]);
    for (const c of (custData ?? []) as { id: string; display_name: string | null }[]) {
      nameById.set(c.id, c.display_name ?? "お客様");
    }
  }

  // VIP voice＝その顧客のスパン内で最新の review.body（無ければ null）。
  const vipVoiceMs: Record<string, number> = {};
  const vipVoice: Record<string, string> = {};
  for (const r of reviews) {
    if (!vipIds.has(r.customer_id)) continue;
    const ms = Date.parse(r.created_at);
    if (!vipVoiceMs[r.customer_id] || ms >= vipVoiceMs[r.customer_id]) {
      vipVoiceMs[r.customer_id] = ms;
      vipVoice[r.customer_id] = r.body;
    }
  }
  const vipCustomers: VipCustomer[] = vipTop.map((v) => ({
    name: nameById.get(v.customer_id) ?? "お客様",
    stampCount: v.count,
    voice: vipVoice[v.customer_id] ?? null,
  }));

  return {
    salonName: (salonRes.data?.name as string | undefined) ?? "サロン",
    label: "今月",
    staffNames,
    staffRole,
    cur,
    prev,
    salonRevenueCur: curTot.revenue,
    salonRevenuePrev: prevTot.revenue,
    totalCountCur: curTot.count,
    totalCountPrev: prevTot.count,
    tierBreakdown,
    recent,
    vipCustomers,
    vipTotal,
    flows,
    monthLabels,
  };
}
