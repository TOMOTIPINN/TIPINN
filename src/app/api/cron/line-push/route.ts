import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  pushText,
  buildVisitReviewText,
  checkFriendship,
} from "@/lib/line-messaging";

/**
 * GET /api/cron/line-push — 来店リマインド通知の送信ワーカー（通知基盤スライス3）。
 *
 * Vercel cron（vercel.json・5〜10分毎）が叩く。notify_at 到達済みの pending を拾って LINE push。
 *   ・既感想スキップ（0024）: その来店日(JST)に review と rating_purchase が**両方**ある顧客には送らない
 *     （感想も評価スタンプも送った＝十分エンゲージ済み・的外れな「来店ありがとう」を出さない）。
 *     片方だけなら送る。race（SELECT 後にお客様が送信）は許容＝既送信者に1通届くだけ。
 *   ・鮮度優先スキップ: notify_at が古い(+STALE_HOURS超) / 友だちでない / line_user_id 無し は送らない。
 *     判定順は 0024 以来のまま（already_completed → no_line_user → not_friend → stale）。
 *     not_friend を stale より先に見る＝「友だちでなかった」を「古かった」で塗り潰さない。
 *   ・★友だち判定は毎回 LINE に問い合わせる（checkFriendship = GET /v2/bot/profile）★
 *     DB の customers.line_is_friend は **送信可否に使わない**（UI キャッシュに降格）。
 *     理由: このフラグは follow webhook でしか更新されず、follow がログイン先行だと
 *     false のまま取り残される（実測で nun の22人が該当＝1通も送られていなかった）。
 *     push の応答では判定できない（ブロック済み宛にも 200 が返る仕様・LINE 公式FAQ）ため、
 *     404 の条件が明文化されている profile API を使う。判定結果は line_is_friend に書き戻す。
 *   ・送信成功→'sent'（sent_at）/ 恒久的な失敗→'failed'。
 *   ・一時エラー（429 / 5xx / ネットワーク断）は **pending のまま** attempt_count を +1 して
 *     次回 cron で再試行し、MAX_ATTEMPTS に達したら failed で閉じる（0044）。
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

// skip の理由（0024 + 0044・notification_outbox.skip_reason の CHECK と一致させる）。
type SkipReason =
  | "already_completed"
  | "stale"
  | "not_friend"
  | "no_line_user"
  | "invalid_user_id";

type OutboxRow = {
  id: string;
  customer_id: string;
  salon_id: string;
  visited_on: string; // JST の来店暦日（既感想スキップの判定キー）
  notify_at: string;
  attempt_count: number; // 0044。一時エラーでの再試行回数
  // line_is_friend は **送信可否には使わない**（UI キャッシュの現在値を知るためだけに引く）。
  customers: { line_user_id: string | null; line_is_friend: boolean } | null;
  salons: { name: string | null } | null;
};

/**
 * 一時エラーでの再試行上限。超えたら failed で閉じる。
 *
 * 根拠:
 *   ・cron は10分間隔（vercel.json）。5回 ＝ 初回 + 4回再試行 ＝ 約40〜50分の再試行ウィンドウ。
 *   ・LINE 側の 429 / 5xx は通常この範囲で復旧する。それを超えて続くなら一時障害ではなく、
 *     failed で閉じて人が気づける状態にする方がよい（黙って再試行し続けない）。
 *   ・notification_outbox は来店1回につき1行。同一顧客の次の通知まで最短でも
 *     notify_after_minutes（DB CHECK は10〜360分・0042）空くため、50分の再試行が
 *     次サイクルに食い込まない。
 *   ・絶対的な打ち止めは STALE_HOURS(24h) の鮮度ゲートで、こちらが常に先に効く
 *     （24h ＝ 最大144回の cron 機会があるので、回数上限が無いと延々と再試行できてしまう）。
 */
const MAX_ATTEMPTS = 5;

/** 再試行する価値のある HTTP ステータスか（429 / 5xx / ネットワーク断=0）。 */
function isTransient(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}

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
      "id, customer_id, salon_id, visited_on, notify_at, attempt_count, customers(line_user_id, line_is_friend), salons(name)",
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
  let retried = 0; // 一時エラーで pending のまま次回に回した件数
  // skip の理由別カウント（即時観測用。DB 側は skip_reason 列で durable に残る）。
  const skips: Record<SkipReason, number> = {
    already_completed: 0,
    stale: 0,
    not_friend: 0,
    no_line_user: 0,
    invalid_user_id: 0,
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

    // (2) 宛先が無い（DB だけで判定できる・API を叩く前に弾く）。
    const lineUserId = row.customers?.line_user_id ?? null;
    if (!lineUserId) {
      await skip(row.id, "no_line_user");
      continue;
    }

    // (3) 友だち判定は **毎回 LINE に問い合わせる**（DB の line_is_friend は見ない）。
    //     line_is_friend は follow webhook でしか更新されず、follow がログイン先行だと
    //     false のまま取り残される（実測で22人が該当）。送信可否をそこに依存させない。
    const friendship = await checkFriendship(lineUserId);

    if (friendship.kind === "not_friend") {
      // 届かないことが確定。理由つきで閉じ、DB のキャッシュも実態に合わせて false に直す。
      console.warn("[line-push] not_friend", {
        outbox_id: row.id,
        customer_id: row.customer_id,
        status: friendship.status,
        body: friendship.body,
      });
      await cacheFriendFlag(row.customer_id, false);
      await skip(row.id, "not_friend");
      continue;
    }

    if (friendship.kind === "invalid") {
      // ID の形式不正・実在しない ID（demo: 合成IDなど）。再試行しても永久に通らない。
      console.warn("[line-push] invalid_user_id", {
        outbox_id: row.id,
        customer_id: row.customer_id,
        status: friendship.status,
        body: friendship.body,
      });
      await skip(row.id, "invalid_user_id");
      continue;
    }

    if (friendship.kind === "error") {
      // 一時エラー（429 / 5xx / トークン不正 / ネットワーク断）。pending のまま次回に回す。
      const r = await retryLater(row, "friendship", friendship.status, friendship.body);
      if (r === "retried") retried++;
      else if (r === "failed") failed++;
      continue;
    }

    // 友だち確定。送信結果を真実として扱い、キャッシュを true 方向にも直す
    // （AddFriendCard の出し分け用。stale で送らない場合でもこの補正はしておく）。
    if (row.customers?.line_is_friend !== true) {
      await cacheFriendFlag(row.customer_id, true);
    }

    // (4) 鮮度スキップ。**not_friend より後**に置く（0024 以来の順序を維持）。
    //     ここを friend 判定より前に出すと「stale かつ not_friend」の行の skip_reason が
    //     stale に変わり、調査時に「友だちでなかったのか、古かっただけか」が読めなくなる。
    if (row.notify_at < staleBeforeIso) {
      await skip(row.id, "stale");
      continue;
    }

    const salonName = row.salons?.name ?? "サロン";
    const reviewUrl = `${baseUrl}/review?salon=${row.salon_id}`;
    const result = await pushText(
      lineUserId,
      buildVisitReviewText(salonName, reviewUrl),
    );

    if (result.ok) {
      if (await mark(row.id, "sent")) sent++;
      continue;
    }

    // push 側の失敗。429 / 5xx / ネットワーク断は一時エラーとして再試行に回す。
    if (isTransient(result.status)) {
      const r = await retryLater(row, "push", result.status, result.body);
      if (r === "retried") retried++;
      else if (r === "failed") failed++;
      continue;
    }

    console.error("[line-push] push failed", {
      id: row.id,
      status: result.status,
      body: result.body,
    });
    if (await mark(row.id, "failed")) failed++;
  }

  const skipped =
    skips.already_completed +
    skips.stale +
    skips.not_friend +
    skips.no_line_user +
    skips.invalid_user_id;

  return NextResponse.json({
    ok: true,
    picked: rows.length,
    sent,
    skipped,
    skippedByReason: skips,
    retried, // pending のまま次回に回した件数（一時エラー）
    failed,
  });
}

/**
 * 一時エラー。attempt_count を +1 して **pending のまま**残し、次回 cron に回す。
 * 上限（MAX_ATTEMPTS）に達したら failed で閉じる。
 *
 * @returns "retried" = pending のまま次回へ / "failed" = 上限到達で閉じた /
 *          "noop" = 他プロセスが既に確定済みで何もしなかった
 */
async function retryLater(
  row: OutboxRow,
  phase: "friendship" | "push",
  status: number,
  body: string,
): Promise<"retried" | "failed" | "noop"> {
  const next = (row.attempt_count ?? 0) + 1;
  const log = {
    outbox_id: row.id,
    customer_id: row.customer_id,
    phase,
    attempt_count: next,
    status,
    body,
  };

  // 回数は常に残す（何回粘ったのかを後から追えるように）。
  await bumpAttempt(row.id, next);

  if (next >= MAX_ATTEMPTS) {
    console.error("[line-push] transient error: 上限到達で failed", log);
    return (await mark(row.id, "failed")) ? "failed" : "noop";
  }

  console.warn("[line-push] transient error: 次回 cron で再試行", log);
  return "retried";
}

/**
 * attempt_count を更新する。status は触らない（pending のまま）。
 * .eq('status','pending') ガード付き＝他プロセスが確定済みなら何もしない。
 */
async function bumpAttempt(id: string, next: number): Promise<void> {
  const { error } = await supabaseAdmin
    .from("notification_outbox")
    .update({ attempt_count: next })
    .eq("id", id)
    .eq("status", "pending");
  if (error) console.error("[line-push] bumpAttempt failed", { id, error });
}

/**
 * customers.line_is_friend を LINE の実態に合わせて直す（**UI キャッシュの更新のみ**）。
 *
 * この値は AddFriendCard（/mypage）の出し分けにしか使わない。送信可否の判定には使わない
 * ＝ここが古くても通知は落ちない。更新に失敗しても cron は止めない（ログのみ）。
 */
async function cacheFriendFlag(
  customerId: string,
  isFriend: boolean,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("customers")
    .update({ line_is_friend: isFriend })
    .eq("id", customerId);
  if (error) {
    console.error("[line-push] line_is_friend キャッシュ更新に失敗", {
      customerId,
      isFriend,
      error,
    });
  }
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
