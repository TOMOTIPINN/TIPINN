import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * POST /api/line/webhook — LINE Messaging API の webhook 受け口（通知基盤スライス2）。
 *
 * このスライスでやること: follow/unfollow を検知して customers.line_is_friend を更新するだけ。
 *   ・push 送信・cron・通知 outbox はまだ作らない（後続スライス）。
 *
 * セキュリティ / 堅牢性:
 *   ・x-line-signature を Messaging チャネルの Channel secret で必ず検証（HMAC-SHA256・base64）。
 *     不正署名は 401。検証には **生body**（req.text()）を使う（JSONパース前に読む）。
 *   ・LINE は再送・タイムアウトするので、検証を通ったら常に速やかに 200 を返す
 *     （DB更新の失敗もログのみで 200。イベント欠落より二重フォロー通知の方が無害）。
 *   ・Messaging 用 env は LINE_MESSAGING_CHANNEL_SECRET（ログイン用 LINE_CHANNEL_SECRET とは別チャネル）。
 */
export const runtime = "nodejs"; // crypto での署名検証は Node ランタイムで

type LineEvent = {
  type: string;
  source?: { type?: string; userId?: string };
};

/** x-line-signature を Channel secret で検証（HMAC-SHA256 → base64、timing-safe 比較）。 */
function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  // 長さが違うと timingSafeEqual が例外を投げるので先に弾く。
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  // 生body を先に読む（署名は raw に対して計算されているため）。
  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature");
  const secret = process.env.LINE_MESSAGING_CHANNEL_SECRET;

  if (!secret) {
    // サーバー設定漏れ。検証できないので受理しない。
    console.error("[line-webhook] missing LINE_MESSAGING_CHANNEL_SECRET");
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  if (!signature || !verifySignature(rawBody, signature, secret)) {
    console.warn("[line-webhook] invalid signature");
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  // 署名OK。以降は失敗してもログのみで 200（LINE の再送・タイムアウトを避ける）。
  let events: LineEvent[] = [];
  try {
    const parsed = JSON.parse(rawBody) as { events?: LineEvent[] };
    events = parsed.events ?? [];
  } catch {
    // 検証は通ったが body が壊れている（LINE の疎通確認等）。200 で受け流す。
    return NextResponse.json({ received: true });
  }

  for (const ev of events) {
    const userId = ev.source?.userId;
    if (!userId) continue; // userId を伴わないイベントは対象外
    if (ev.type === "follow") {
      await setFriend(userId, true);
    } else if (ev.type === "unfollow") {
      await setFriend(userId, false);
    }
    // それ以外（message 等）は今回は何もしない。
  }

  return NextResponse.json({ received: true });
}

/**
 * customers.line_is_friend を更新（service_role・RLSバイパス）。
 * follow が login より先に来た場合 customers 行がまだ無い → 0件更新でログのみ
 *   （空の顧客行は作らない＝中央台帳を汚さない・原則7。ログイン先行が通常フロー）。
 */
async function setFriend(lineUserId: string, isFriend: boolean): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("customers")
    .update({ line_is_friend: isFriend })
    .eq("line_user_id", lineUserId)
    .select("id");

  if (error) {
    console.error("[line-webhook] failed to update line_is_friend", {
      isFriend,
      error,
    });
    return;
  }
  if (!data || data.length === 0) {
    // 未ログインで先にフォローされたケース。今回のスライスでは記録対象外。
    console.warn(
      `[line-webhook] ${isFriend ? "follow" : "unfollow"} for unknown line_user_id (no customer row yet)`,
    );
  }
}
