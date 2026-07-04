import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { pushText, buildVisitReviewText } from "@/lib/line-messaging";

/**
 * GET /api/cron/line-push — 来店リマインド通知の送信ワーカー（通知基盤スライス3）。
 *
 * Vercel cron（vercel.json・5〜10分毎）が叩く。notify_at 到達済みの pending を拾って LINE push。
 *   ・拾う条件: status=pending かつ notify_at<=now かつ 友だち(line_is_friend=true)。
 *   ・鮮度優先: notify_at が古い(+STALE_HOURS超) / 友だちでない は送らず 'skipped'（原則: 数日後の
 *     的外れな「来店ありがとう」を飛ばさない）。
 *   ・送信成功→'sent'（sent_at）/ 送信失敗→'failed'（次回再送はしない・ログのみ）。
 *   ・状態遷移は必ず .eq('status','pending') ガード付きで、cron 重複起動の二重送信を防ぐ。
 *
 * 認可: Vercel cron は CRON_SECRET を Authorization: Bearer で付与する。一致しなければ 401。
 * 書き込みは supabaseAdmin・サーバー側のみ（RLS deny-by-default）。¥・賞与は扱わない（原則5/6）。
 */
export const runtime = "nodejs";

const STALE_HOURS = 24; // notify_at からこれを超えた pending は送らず skip（鮮度優先）
const BATCH = 100; // 1 回の cron で処理する最大件数

type OutboxRow = {
  id: string;
  salon_id: string;
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
      "id, salon_id, notify_at, customers(line_user_id, line_is_friend), salons(name)",
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
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const friend = row.customers?.line_is_friend === true;
    const lineUserId = row.customers?.line_user_id ?? null;
    const isStale = row.notify_at < staleBeforeIso;

    // 鮮度優先: 古すぎる / 友だちでない / userId 無し は送らず skip。
    if (isStale || !friend || !lineUserId) {
      if (await mark(row.id, "skipped")) skipped++;
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
    } else {
      console.error("[line-push] push failed", {
        id: row.id,
        status: result.status,
        body: result.body,
      });
      if (await mark(row.id, "failed")) failed++;
    }
  }

  return NextResponse.json({
    ok: true,
    picked: rows.length,
    sent,
    skipped,
    failed,
  });
}

/**
 * outbox の status を pending からのみ遷移させる（二重送信防止のガード）。
 * sent のときだけ sent_at を打つ。更新できたら true。
 */
async function mark(
  id: string,
  status: "sent" | "skipped" | "failed",
): Promise<boolean> {
  const patch: { status: string; sent_at?: string } =
    status === "sent"
      ? { status, sent_at: new Date().toISOString() }
      : { status };

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
