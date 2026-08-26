import { supabaseAdmin } from "@/lib/supabase-admin";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { DEMO_SALON_ID } from "@/lib/demo";

/**
 * echo Labs 運営用・サロン別の稼働集計（/admin/salons の集計層・server専用）。
 *
 * 目的は「どのサロンがどこで詰まっているか」を運営が一目で見ること。オーナー向けの
 * ダッシュボード（/dashboard・dashboard-data.ts）とは読者も目的も別物なので、別レイヤに置く。
 *
 * ★スタッフ別の内訳は絶対に出さない★
 *   reviews / rating_purchases は staff_id を持つが、この集計では**意図的に選択しない**。
 *   docs/00_philosophy.md §4.1（スタッフをスコア化・ランキングしない）／§4.5（競争を煽らない・
 *   格差を可視化しない）による制限。運営がサロンをコンサルするのに必要な粒度はサロン単位で足り、
 *   スタッフ単位の数字は「echo が個人を裁く道具」に転用され得る。集計しなければ転用もできない。
 *   ＝ここは技術的制約ではなく、意図的に狭めた設計である。広げないこと。
 *
 * 集計期間: **直近30日固定**（期間切替は作らない＝運営が毎回同じ物差しで見るため）。
 *   JST(Asia/Tokyo) の当日0:00から30日遡った時刻 〜 現在。dashboard の period.ts と同じ日境界の作法。
 *   ・reviews / rating_purchases / notification_outbox … created_at（timestamptz）で範囲比較。
 *   ・visits.visited_on … date 型（JST暦日）なので 'YYYY-MM-DD' の文字列比較。
 *   ・在籍スタッフ数だけは期間に関係ない「現在の人数」（archived_at is null）。
 *
 * 除外:
 *   ・テストサロン / デモサロンは行ごと出さない（EXCLUDED_SALON_IDS）。
 *   ・デモ顧客（customers.line_user_id が 'demo:' 接頭辞）は全集計から除外する。デモ seed は
 *     visits を持たないまま reviews / rating_purchases だけを持つため、混ぜると感想率・有料率が壊れる。
 *
 * N+1 を作らない:
 *   サロン件数に関係なく **クエリ本数は固定7本**。1本にまとめるには SQL のビュー/RPC が要るが、
 *   この画面は「DBを変更しない」制約で作っているため（migration 無し）、テーブルごとに1本ずつ引いて
 *   JS 側で salon_id に畳む。サロンを増やしてもクエリ本数は増えない（/admin/invites と同じ作法）。
 */

/** JST は UTC+9 固定（サマータイム無し）。dashboard-data.ts / period.ts と同一。 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 集計窓（日数）。固定＝画面から変更できない。 */
export const WINDOW_DAYS = 30;

/**
 * 集計から除外するサロン（運営の実績ではないもの）。
 * デモサロンは固定UUID（@/lib/demo が唯一の正）。テストサロンは開発初期の検証用で、
 * Stripe テスト連結アカウントが紐づいたまま実データに混ざるため運営集計には出さない。
 */
export const EXCLUDED_SALON_IDS: readonly string[] = [
  DEMO_SALON_ID,
  "682336ef-997e-4b07-876e-b71fb032b71b", // テストサロン
];

/** デモ顧客の line_user_id 接頭辞（@/lib/demo の persona と同じ規約）。 */
const DEMO_LINE_PREFIX = "demo:";

/** notification_outbox.skip_reason（0024 / 0044 の CHECK と一致）。null は「理由不明の旧skip」。 */
export const SKIP_REASON_LABEL: Record<string, string> = {
  not_friend: "友だち未追加",
  stale: "時間切れ",
  already_completed: "対応済み",
  no_line_user: "LINE未連携",
  unknown: "理由不明",
};

export type SkipBreakdown = { reason: string; label: string; count: number };

export type AdminSalonRow = {
  salonId: string;
  salonName: string;
  /** 在籍スタッフ数（archived_at is null・期間に依存しない現在値）。 */
  staffCount: number;
  /** 新規顧客数（このサロンでの初回来店が期間内に入る顧客の数）。 */
  newCustomers: number;
  sent: number;
  skipped: number;
  skipBreakdown: SkipBreakdown[];
  reviews: number;
  /** 感想数 ÷ sent数。sent が0なら null（＝「—」表示・0除算ガード）。 */
  reviewRate: number | null;
  purchases: number;
  /** 有料スタンプ数 ÷ sent数。sent が0なら null。 */
  purchaseRate: number | null;
  /** 有料スタンプの金額合計（円・税込）。店舗合計のみ＝スタッフ別には割らない。 */
  amount: number;
};

export type AdminSalonStats = {
  rows: AdminSalonRow[];
  /** 集計窓の下限（JST日境界・UTC ISO）。 */
  periodStartISO: string;
  /** 集計窓の下限（JST暦日 'YYYY-MM-DD'・visited_on 比較用/表示用）。 */
  periodStartDate: string;
  /** 集計時刻（JST暦日）。 */
  todayDate: string;
};

/** JST の当日0:00 を UTC ミリ秒で返す。 */
function jstDayStartMs(nowMs: number): number {
  const d = new Date(nowMs + JST_OFFSET_MS);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - JST_OFFSET_MS;
}

/** UTC ミリ秒 → JST 暦日 'YYYY-MM-DD'。 */
function jstDateString(ms: number): string {
  return new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10);
}

type SalonRow = { id: string; name: string };
type StaffRow = { salon_id: string };
type VisitRow = {
  id: string;
  salon_id: string;
  customer_id: string;
  visited_on: string;
};
type OutboxRow = {
  id: string;
  salon_id: string;
  customer_id: string;
  status: string;
  skip_reason: string | null;
};
type ReviewRow = { id: string; salon_id: string; customer_id: string };
type PurchaseRow = {
  id: string;
  salon_id: string;
  customer_id: string;
  amount: number;
};

/** 0除算ガード。分母0は null（呼び出し側で「—」）。 */
function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

/**
 * サロン別の直近30日集計を返す（運営専用）。
 * @param nowMs 集計時刻（テスト用に注入可能・既定は現在時刻）
 */
export async function getAdminSalonStats(
  nowMs: number = Date.now(),
): Promise<AdminSalonStats> {
  const periodStartMs = jstDayStartMs(nowMs) - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const periodStartISO = new Date(periodStartMs).toISOString();
  const periodStartDate = jstDateString(periodStartMs);
  const todayDate = jstDateString(nowMs);

  // ── 1) 対象サロン（テスト・デモを除外）─────────────────────
  const { data: salonData } = await supabaseAdmin
    .from("salons")
    .select("id, name")
    .not("id", "in", `(${EXCLUDED_SALON_IDS.join(",")})`)
    .order("name", { ascending: true });
  const salons = (salonData ?? []) as SalonRow[];

  const empty: AdminSalonStats = {
    rows: [],
    periodStartISO,
    periodStartDate,
    todayDate,
  };
  if (salons.length === 0) return empty;
  const salonIds = salons.map((s) => s.id);

  // ── 2) デモ顧客（'demo:' 接頭辞）─────────────────────────
  // id だけを引く（line_user_id は PII・原則7。ここでは突合に使うだけで保持しない）。
  const { data: demoData } = await supabaseAdmin
    .from("customers")
    .select("id")
    .like("line_user_id", `${DEMO_LINE_PREFIX}%`);
  const demoCustomerIds = new Set((demoData ?? []).map((c) => c.id as string));
  const isDemo = (customerId: string) => demoCustomerIds.has(customerId);

  // ── 3) 在籍スタッフ（現在値・期間非依存）───────────────────
  const staffRows = await fetchAllRows<StaffRow>(
    (from, to) =>
      supabaseAdmin
        .from("staff")
        .select("id, salon_id")
        .in("salon_id", salonIds)
        .is("archived_at", null)
        .order("id", { ascending: true })
        .range(from, to),
    { label: "staff" },
  );

  // ── 4) 来店（全期間）────────────────────────────────────
  // 「新規顧客」は (顧客, サロン) の**初回来店**が期間内にあるか、で判定する。
  // 期間内の visits だけでは「30日以内に来ただけの常連」と区別できないため、履歴全体が要る。
  // customers の単純カウントは使わない（顧客は echo 全体で1アカウント＝salon_id を持たない。
  // スタッフ本人・デモ・未来店ログインが混ざり、サロン別の新規数にはならない）。
  const visitRows = await fetchAllRows<VisitRow>(
    (from, to) =>
      supabaseAdmin
        .from("visits")
        .select("id, salon_id, customer_id, visited_on")
        .in("salon_id", salonIds)
        .order("visited_on", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    { label: "visits" },
  );

  // ── 5) 通知 outbox（期間内・created_at 基準）────────────────
  // created_at＝来店時刻（enqueue は来店RPCと同一トランザクション）。sent_at は送信時刻で
  // skipped 行には無いため、status をまたいで同じ母集団を数えられる created_at を窓に使う。
  const outboxRows = await fetchAllRows<OutboxRow>(
    (from, to) =>
      supabaseAdmin
        .from("notification_outbox")
        .select("id, salon_id, customer_id, status, skip_reason")
        .in("salon_id", salonIds)
        .gte("created_at", periodStartISO)
        .order("id", { ascending: true })
        .range(from, to),
    { label: "notification_outbox" },
  );

  // ── 6) 感想（期間内）─────────────────────────────────────
  // staff_id は選択しない（冒頭の★参照・docs/00_philosophy.md §4.1 / §4.5）。
  const reviewRows = await fetchAllRows<ReviewRow>(
    (from, to) =>
      supabaseAdmin
        .from("reviews")
        .select("id, salon_id, customer_id")
        .in("salon_id", salonIds)
        .gte("created_at", periodStartISO)
        .order("id", { ascending: true })
        .range(from, to),
    { label: "reviews" },
  );

  // ── 7) 有料スタンプ（期間内）──────────────────────────────
  // amount は店舗合計にのみ使う（原則5・§4.2 スタッフ個人の¥は出さない）。staff_id は選択しない。
  const purchaseRows = await fetchAllRows<PurchaseRow>(
    (from, to) =>
      supabaseAdmin
        .from("rating_purchases")
        .select("id, salon_id, customer_id, amount")
        .in("salon_id", salonIds)
        .gte("created_at", periodStartISO)
        .order("id", { ascending: true })
        .range(from, to),
    { label: "rating_purchases" },
  );

  // ── 畳み込み（salon_id 単位・JS側）──────────────────────────
  const staffCount = new Map<string, number>();
  for (const s of staffRows) {
    staffCount.set(s.salon_id, (staffCount.get(s.salon_id) ?? 0) + 1);
  }

  // (顧客, サロン) ごとの初回来店日。visits は visited_on 昇順で引いているので最初の1件が初回。
  const firstVisit = new Map<string, string>();
  for (const v of visitRows) {
    if (isDemo(v.customer_id)) continue;
    const key = `${v.customer_id}|${v.salon_id}`;
    const cur = firstVisit.get(key);
    if (cur === undefined || v.visited_on < cur) firstVisit.set(key, v.visited_on);
  }
  const newCustomers = new Map<string, number>();
  for (const [key, first] of firstVisit) {
    if (first < periodStartDate) continue; // 初回が窓より前＝既存客
    const salonId = key.slice(key.indexOf("|") + 1);
    newCustomers.set(salonId, (newCustomers.get(salonId) ?? 0) + 1);
  }

  const sent = new Map<string, number>();
  const skipped = new Map<string, number>();
  const skipReasons = new Map<string, Map<string, number>>();
  for (const o of outboxRows) {
    if (isDemo(o.customer_id)) continue;
    if (o.status === "sent") {
      sent.set(o.salon_id, (sent.get(o.salon_id) ?? 0) + 1);
    } else if (o.status === "skipped") {
      skipped.set(o.salon_id, (skipped.get(o.salon_id) ?? 0) + 1);
      const reason = o.skip_reason ?? "unknown";
      const per = skipReasons.get(o.salon_id) ?? new Map<string, number>();
      per.set(reason, (per.get(reason) ?? 0) + 1);
      skipReasons.set(o.salon_id, per);
    }
    // pending / failed は列に出さない（送れていない理由としては skipped が本命。
    // pending は「まだ送信時刻が来ていない」だけで、詰まりの指標にならない）。
  }

  const reviewCount = new Map<string, number>();
  for (const r of reviewRows) {
    if (isDemo(r.customer_id)) continue;
    reviewCount.set(r.salon_id, (reviewCount.get(r.salon_id) ?? 0) + 1);
  }

  const purchaseCount = new Map<string, number>();
  const amountSum = new Map<string, number>();
  for (const p of purchaseRows) {
    if (isDemo(p.customer_id)) continue;
    purchaseCount.set(p.salon_id, (purchaseCount.get(p.salon_id) ?? 0) + 1);
    amountSum.set(p.salon_id, (amountSum.get(p.salon_id) ?? 0) + p.amount);
  }

  const rows: AdminSalonRow[] = salons.map((s) => {
    const sentN = sent.get(s.id) ?? 0;
    const reviewsN = reviewCount.get(s.id) ?? 0;
    const purchasesN = purchaseCount.get(s.id) ?? 0;
    const per = skipReasons.get(s.id);
    const breakdown: SkipBreakdown[] = per
      ? [...per.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([reason, count]) => ({
            reason,
            label: SKIP_REASON_LABEL[reason] ?? reason,
            count,
          }))
      : [];

    return {
      salonId: s.id,
      salonName: s.name,
      staffCount: staffCount.get(s.id) ?? 0,
      newCustomers: newCustomers.get(s.id) ?? 0,
      sent: sentN,
      skipped: skipped.get(s.id) ?? 0,
      skipBreakdown: breakdown,
      reviews: reviewsN,
      reviewRate: rate(reviewsN, sentN),
      purchases: purchasesN,
      purchaseRate: rate(purchasesN, sentN),
      amount: amountSum.get(s.id) ?? 0,
    };
  });

  return { rows, periodStartISO, periodStartDate, todayDate };
}
