import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { pushText, buildVisitReviewText } from "@/lib/line-messaging";

/**
 * GET /api/cron/line-push — 来店リマインド通知の送信ワーカー（通知基盤スライス3）。
 *
 * Vercel cron（vercel.json・5〜10分毎）が叩く。notify_at 到達済みの pending を拾って LINE push。
 *   ・既感想スキップ（0024）: その来店日(JST)に review と rating_purchase が**両方**ある顧客には送らない
 *     （感想も評価スタンプも送った＝十分エンゲージ済み・的外れな「来店ありがとう」を出さない）。
 *     片方だけなら送る。race（SELECT 後にお客様が送信）は許容＝既送信者に1通届くだけ。
 *   ・鮮度優先スキップ: notify_at が古い(+STALE_HOURS超) / 友だちでない / line_user_id 無し は送らない。
 *   ・送信成功→'sent'（sent_at）/ 送信失敗→'failed'（次回再送はしない・ログのみ）。
 *   ・skip はすべて status='skipped' ＋ skip_reason（0024）で理由を残す。後日
 *     `select skip_reason, count(*) ... where status='skipped' group by skip_reason` で内訳を観測できる。
 *   ・状態遷移は必ず .eq('status','pending') ガード付きで、cron 重複起動の二重送信を防ぐ。
 *
 * 認可: Vercel cron は CRON_SECRET を Authorization: Bearer で付与する。一致しなければ 401。
 * 書き込みは supabaseAdmin・サーバー側のみ（RLS deny-by-default）。¥・賞与は扱わない（原則5/6）。
 */
export const runtime = "nodejs";

const STALE_HOURS = 24; // notify_at からこれを超えた pending は送らず skip（鮮度優先）
const BATCH = 100; // 1 回の cron で処理する最大件数

// skip の理由（0024・notification_outbox.skip_reason の CHECK と一致させる）。
type SkipReason = "already_completed" | "stale" | "not_friend" | "no_line_user";

type OutboxRow = {
  id: string;
  customer_id: string;
  salon_id: string;
  visited_on: string; // JST の来店暦日（既感想スキップの判定キー）
  notify_at: string;
  customers: { line_user_id: string | null; line_is_friend: boolean } | null;
  salons: { name: string | null } | null;
};

export async function GET(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[line-push] missing CRON_SECRET");
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const baseUrl = process.env.APP_BASE_URL!;
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const staleBeforeIso = new Date(nowMs - STALE_HOURS * 3600_000).toISOString();

  // 送信予定が到達した pending を、顧客(friend/line_user_id)とサロン名を同時取得。
  const { data, error } = await supabaseAdmin
    .from("notification_outbox")
    .select(
      "id, customer_id, salon_id, visited_on, notify_at, customers(line_user_id, line_is_friend), salons(name)",
    )
    .eq("status", "pending")
    .lte("notify_at", nowIso)
    .order("notify_at", { ascending: true })
    .limit(BATCH);

  if (error) {
    console.error("[line-push] query failed:", error);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as OutboxRow[];
  let sent = 0;
  let failed = 0;
  // skip の理由別カウント（即時観測用。DB 側は skip_reason 列で durable に残る）。
  const skips: Record<SkipReason, number> = {
    already_completed: 0,
    stale: 0,
    not_friend: 0,
    no_line_user: 0,
  };
  const skip = async (id: string, reason: SkipReason): Promise<void> => {
    if (await mark(id, "skipped", reason)) skips[reason]++;
  };

  for (const row of rows) {
    // (1) 既感想スキップ（0024）: その来店日(JST)に review と rating_purchase が両方あれば送らない。
    //     鮮度判定より先に見る＝「送る必要がそもそも無い」を最優先で弾く（既送信者に届けない）。
    if (
      await hasReviewAndPurchase(row.customer_id, row.salon_id, row.visited_on)
    ) {
      await skip(row.id, "already_completed");
      continue;
    }

    // (2) 鮮度優先スキップ（理由を区別して観測可能に）。
    const friend = row.customers?.line_is_friend === true;
    const lineUserId = row.customers?.line_user_id ?? null;
    if (!lineUserId) {
      await skip(row.id, "no_line_user");
      continue;
    }
    if (!friend) {
      await skip(row.id, "not_friend");
      continue;
    }
    if (row.notify_at < staleBeforeIso) {
      await skip(row.id, "stale");
      continue;
    }

    // 送信。
    const salonName = row.salons?.name ?? "サロン";
    const reviewUrl = `${baseUrl}/review?salon=${row.salon_id}`;
    const result = await pushText(
      lineUserId,
      buildVisitReviewText(salonName, reviewUrl),
    );

    if (result.ok) {
      if (await mark(row.id, "sent")) sent++;
    } else {
      console.error("[line-push] push failed", {
        id: row.id,
        status: result.status,
        body: result.body,
      });
      if (await mark(row.id, "failed")) failed++;
    }
  }

  const skipped =
    skips.already_completed + skips.stale + skips.not_friend + skips.no_line_user;

  return NextResponse.json({
    ok: true,
    picked: rows.length,
    sent,
    skipped,
    skippedByReason: skips,
    failed,
  });
}

/**
 * その来店日(JST)に、この (customer_id, salon_id) の review と rating_purchase が
 * 「両方」存在するか。存在すれば既感想スキップの対象（送らない）。
 *
 * visit_id が reviews / rating_purchases に無いため（0024 調査）、判定キーは
 * customer_id + salon_id + 「created_at の JST 暦日 == outbox.visited_on」。
 * reviews は 1/顧客/サロン/JST日（0020）、outbox.visited_on も JST 暦日で整合する。
 * PostgREST 上は JST 暦日を UTC 範囲 [その日00:00 JST, 翌日00:00 JST) に展開して created_at を挟む。
 */
async function hasReviewAndPurchase(
  customerId: string,
  salonId: string,
  visitedOn: string,
): Promise<boolean> {
  const start = new Date(`${visitedOn}T00:00:00+09:00`); // JST 当日 0 時
  const startIso = start.toISOString();
  const endIso = new Date(start.getTime() + 24 * 3600_000).toISOString();

  const [reviewRes, purchaseRes] = await Promise.all([
    supabaseAdmin
      .from("reviews")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId)
      .eq("salon_id", salonId)
      .gte("created_at", startIso)
      .lt("created_at", endIso),
    supabaseAdmin
      .from("rating_purchases")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId)
      .eq("salon_id", salonId)
      .gte("created_at", startIso)
      .lt("created_at", endIso),
  ]);

  return (reviewRes.count ?? 0) > 0 && (purchaseRes.count ?? 0) > 0;
}

/**
 * outbox の status を pending からのみ遷移させる（二重送信防止のガード）。
 * sent のときだけ sent_at を打つ。skipped のときは skip_reason（0024）を残す。更新できたら true。
 */
async function mark(
  id: string,
  status: "sent" | "skipped" | "failed",
  skipReason: SkipReason | null = null,
): Promise<boolean> {
  const patch: { status: string; sent_at?: string; skip_reason?: string } = {
    status,
  };
  if (status === "sent") patch.sent_at = new Date().toISOString();
  if (status === "skipped" && skipReason) patch.skip_reason = skipReason;

  const { data, error } = await supabaseAdmin
    .from("notification_outbox")
    .update(patch)
    .eq("id", id)
    .eq("status", "pending") // 既に他プロセスが処理済みなら 0 件（＝二重送信しない）
    .select("id");

  if (error) {
    console.error("[line-push] mark failed", { id, status, error });
    return false;
  }
  return (data?.length ?? 0) > 0;
}
