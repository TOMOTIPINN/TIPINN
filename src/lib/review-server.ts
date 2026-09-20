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
import {
  isPurchasableReview,
  type PurchasableReviewRow,
} from "@/lib/review-purchase";

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
 * select は判定に使う4列のみ。**body は取らない**
 * （感想本文は購入可否の判断に不要で、取らなければ取り違えて表示することもない）。
 * **rating も share_scope も取らない**（§14 ／ §19 で購入条件から外した）。
 * 取ってこなければ、この場で閾値や共有範囲の条件を書き足すこともできない。
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
    .select("id, customer_id, salon_id, staff_id")
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

/* ---- /mypage の補助導線（§15） ---- */

/** 1サロンぶんの「いま出す導線」。どちらも出ないこともある。 */
export type MypageActions = {
  /** 「感想を送る」を出すか（受付期間内に来店があり、その来店ぶんが未送信）。 */
  canReview: boolean;
  /** 目立たせるか（canReview かつ通知予定時刻を過ぎている）。**出すかどうかとは別**。 */
  reviewDue: boolean;
  /** 「評価スタンプを送る」の宛先（購入可能な最新1件）。無ければ null。 */
  purchase: { reviewId: string; staffId: string } | null;
};

type ReviewCandidateRow = PurchasableReviewRow & { created_at: string };

/**
 * `/mypage` のサロンカードに出す補助導線を、**サロンぶん一括で**判定する（§15）。
 *
 * `getSalonRewardsMap` / `getConsumableRewardStatesMap` と同じ作法:
 *   `.in("salon_id", ids)` で引いて `Map` を返す。**クエリ本数はサロン数によらず4本で固定**（N+1 回避）。
 *
 * ★判定の正は他所にある★
 *   ・受付期間 … REVIEW_WINDOW_DAYS（@/lib/review）。日数をここに書き写さない。
 *   ・購入可否 … isPurchasableReview（@/lib/review-purchase）。**クエリで条件を書き写さず、
 *                 最後に必ずこの純粋関数を通す**（条件がクエリと関数の2か所に分かれるのを防ぐ）。
 *   ・通知時刻 … notification_outbox.notify_at。
 *
 * ★LINE リマインドの判定（line-push の hasReviewAndPurchase）とは共有しない★
 *   あちらは「感想**と**購入の**両方**がその来店日にあるとき送らない」で、**別の問いに答える関数**。
 *   共有するのは REVIEW_WINDOW_DAYS と notify_at だけ（docs/40_decisions.md §15）。
 *
 * ★outbox は「通知の台帳」であって受付可否の正ではない★
 *   行が無い来店（同日2回目・来店軸 OFF・0014 適用前の古い来店）はふつうにある。
 *   その場合は **reviewDue=false（目立たせない）に倒すだけ**で、canReview は来店と未送信で決める。
 *   status（sent/skipped/failed）は見ない。LINE が届かなかった人ほどこの導線が要る。
 *
 * 本文（body）も rating も取らない（loadReviewForPurchase と同じ方針）。
 * 取ってこなければ、この場で本文を出したり閾値を書き足したりする余地も生まれない。
 */
export async function getMypageActionsMap(
  customerId: string,
  salonIds: string[],
): Promise<Map<string, MypageActions>> {
  const map = new Map<string, MypageActions>();
  const ids = Array.from(new Set(salonIds)).filter(Boolean);
  if (!customerId || ids.length === 0) return map;

  const today = jstToday();
  const windowStart = jstDateMinusDays(REVIEW_WINDOW_DAYS);
  const windowStartIso = jstDayStartISO(windowStart);
  const nowMs = Date.now();

  // 購入は必ず感想より後に起きるので、感想と同じ窓で絞れば取りこぼさない
  // （購入 created_at >= 対象の感想 created_at >= windowStart）。＝4本を並列にできる。
  const [visitRes, outboxRes, reviewRes, purchaseRes] = await Promise.all([
    supabaseAdmin
      .from("visits")
      .select("salon_id, visited_on")
      .eq("customer_id", customerId)
      .in("salon_id", ids)
      .gte("visited_on", windowStart)
      .lte("visited_on", today),
    supabaseAdmin
      .from("notification_outbox")
      .select("salon_id, visited_on, notify_at")
      .eq("customer_id", customerId)
      .in("salon_id", ids)
      .eq("kind", "visit_review_request")
      .gte("visited_on", windowStart),
    supabaseAdmin
      .from("reviews")
      .select("id, customer_id, salon_id, staff_id, share_scope, created_at")
      .eq("customer_id", customerId)
      .in("salon_id", ids)
      .gte("created_at", windowStartIso)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("rating_purchases")
      .select("review_id")
      .eq("customer_id", customerId)
      .in("salon_id", ids)
      .gte("created_at", windowStartIso),
  ]);

  // 受付期間内の「最終来店日」（visited_on は date 型なので文字列比較でよい）。
  const lastVisitOn = new Map<string, string>();
  for (const v of (visitRes.data ?? []) as { salon_id: string; visited_on: string }[]) {
    const prev = lastVisitOn.get(v.salon_id);
    if (!prev || v.visited_on > prev) lastVisitOn.set(v.salon_id, v.visited_on);
  }

  // 通知予定時刻は (サロン, 来店日) で引く。
  const notifyAt = new Map<string, string>();
  for (const o of (outboxRes.data ?? []) as {
    salon_id: string;
    visited_on: string;
    notify_at: string;
  }[]) {
    notifyAt.set(`${o.salon_id}|${o.visited_on}`, o.notify_at);
  }

  // 感想はサロンごとに新しい順で持つ（上で created_at desc に並べてある）。
  const reviewsBySalon = new Map<string, ReviewCandidateRow[]>();
  for (const r of (reviewRes.data ?? []) as unknown as ReviewCandidateRow[]) {
    const list = reviewsBySalon.get(r.salon_id);
    if (list) list.push(r);
    else reviewsBySalon.set(r.salon_id, [r]);
  }

  const purchasedReviewIds = new Set<string>();
  for (const p of (purchaseRes.data ?? []) as { review_id: string | null }[]) {
    if (p.review_id) purchasedReviewIds.add(p.review_id);
  }

  for (const salonId of ids) {
    const visitedOn = lastVisitOn.get(salonId);
    const salonReviews = reviewsBySalon.get(salonId) ?? [];

    // 1) 感想を送れるか＝受付期間内に来店があり、その来店日以降に感想が無い
    //    （hasReviewedForLatestVisit と同じ2段判定＝RPC 0046 の already_submitted と揃える）。
    const canReview = visitedOn
      ? !salonReviews.some(
          (r) => r.created_at >= jstDayStartISO(visitedOn),
        )
      : false;

    // 2) 目立たせるか＝通知予定時刻を過ぎているか。outbox が無ければ目立たせない。
    const at = visitedOn ? notifyAt.get(`${salonId}|${visitedOn}`) : undefined;
    const reviewDue = canReview && at !== undefined && Date.parse(at) <= nowMs;

    // 3) 購入可能な最新1件。**条件はクエリに書き写さず isPurchasableReview に通す。**
    let purchase: MypageActions["purchase"] = null;
    for (const r of salonReviews) {
      if (purchasedReviewIds.has(r.id)) continue;
      const staffId = r.staff_id;
      // staff_id が null の感想（お店のみんなへ）は購入不可。先に弾いて staffId を絞る。
      if (!staffId) continue;
      if (isPurchasableReview(r, { customerId, salonId, staffId })) {
        purchase = { reviewId: r.id, staffId };
        break;
      }
    }

    if (canReview || purchase) map.set(salonId, { canReview, reviewDue, purchase });
  }

  return map;
}
