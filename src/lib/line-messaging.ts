/**
 * LINE Messaging API の push 送信ヘルパー（サーバー専用・通知基盤スライス3）。
 *
 * ・Messaging チャネル（2010599784）の長期アクセストークンで送る。
 *   env: LINE_MESSAGING_CHANNEL_ACCESS_TOKEN（ログイン用 LINE_CHANNEL_* とは別チャネル）。
 * ・cron（/api/cron/line-push）からのみ呼ぶ想定。¥・賞与には一切触れない（原則5/6）。
 * ・友だち(line_is_friend=true)判定は呼び出し側で済ませてから呼ぶこと。
 */
const PUSH_URL = "https://api.line.me/v2/bot/message/push";

export type PushResult =
  | { ok: true }
  | { ok: false; status: number; body: string };

/** テキスト1通を push 送信する。失敗時は status/body を返す（例外は投げない）。 */
export async function pushText(
  lineUserId: string,
  text: string,
): Promise<PushResult> {
  const token = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    return { ok: false, status: 0, body: "missing_access_token" };
  }

  let res: Response;
  try {
    res = await fetch(PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: lineUserId,
        messages: [{ type: "text", text }],
      }),
    });
  } catch (e) {
    // ネットワーク断など。呼び出し側で failed 扱いにする。
    return { ok: false, status: 0, body: String(e) };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, status: res.status, body };
  }
  return { ok: true };
}

/**
 * 来店後の感想リマインド本文（§5: 温かく・急かさない）。
 * 末尾に /review?salon= への導線を付ける。
 */
export function buildVisitReviewText(
  salonName: string,
  reviewUrl: string,
): string {
  return [
    `${salonName}です。本日はご来店ありがとうございました。`,
    "",
    "もしよければ、担当者へひとことお気持ちを添えていただけたら嬉しいです。急ぎませんし、おうちからでも大丈夫です。",
    "",
    `▽ 感想を送る\n${reviewUrl}`,
  ].join("\n");
}
