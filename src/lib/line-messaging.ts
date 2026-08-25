/**
 * LINE Messaging API の push 送信ヘルパー（サーバー専用・通知基盤スライス3）。
 *
 * ・Messaging チャネル（2010599784）の長期アクセストークンで送る。
 *   env: LINE_MESSAGING_CHANNEL_ACCESS_TOKEN（ログイン用 LINE_CHANNEL_* とは別チャネル）。
 * ・呼び出し元は現在2つ（サーバー側のみ・クライアントからは呼ばない）:
 *     1. cron（/api/cron/line-push）… 顧客への来店リマインド（buildVisitReviewText）
 *     2. @/lib/security-alert … 運営者へのレート制限通知（不正アクセス検知）
 *   顧客宛と運営者宛が混在するため、**送信先の line_user_id は必ず呼び出し側が決める**
 *   （このモジュールは宛先を推測しない）。¥・賞与には一切触れない（原則5/6）。
 * ・友だち判定は checkFriendship() を使う。**DB の customers.line_is_friend は使わない**
 *   （follow webhook でしか更新されず、follow がログイン先行だと false のまま取り残されるため）。
 */
const PUSH_URL = "https://api.line.me/v2/bot/message/push";
const PROFILE_URL = "https://api.line.me/v2/bot/profile";

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
 * 友だち関係の判定結果。
 *   friend        … 友だち（push してよい）
 *   not_friend    … 未追加 / ブロック / プロフィール同意なし（送っても届かない）
 *   invalid       … ID の形式不正・実在しない ID（demo: 合成IDなど）。再試行しても無意味
 *   error         … 一時エラー（429 / 5xx / ネットワーク断 / トークン不正）。再試行の余地あり
 */
export type Friendship =
  | { kind: "friend" }
  | { kind: "not_friend"; status: number; body: string }
  | { kind: "invalid"; status: number; body: string }
  | { kind: "error"; status: number; body: string };

/**
 * 宛先が友だちかを **LINE に問い合わせて** 判定する（GET /v2/bot/profile/{userId}）。
 *
 * ★なぜ push の応答で判定しないか★
 *   push API は「ブロック済み／退会済みの宛先にも 200 を返し、メッセージは届かない」
 *   （LINE 公式 FAQ）。つまり push の戻り値からは友だちでないことを検出できない。
 *   403 は「アカウント/プランの権限」の意味で友だち関係とは無関係、400 は JSON 不正等と
 *   混ざるため、どちらも判定に使えない。
 *
 *   一方 profile API は 404 の条件が明文化されている:
 *     「ユーザーIDが存在しない／プロフィール取得に同意していない／
 *       対象の公式アカウントを友だち追加していない／追加後にブロックした」
 *   ＝ push してよいかどうかの権威ある判定になる。実顧客48人で 200/404/400 が
 *   きれいに分離することを実測済み（22 friend / 20 not_friend / 5 invalid）。
 *
 * **例外は投げない**（呼び出し側の cron を止めない）。
 */
export async function checkFriendship(
  lineUserId: string,
): Promise<Friendship> {
  const token = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    // 設定漏れは一時エラー扱い（not_friend にして行を閉じてしまわない）。
    return { kind: "error", status: 0, body: "missing_access_token" };
  }

  let res: Response;
  try {
    res = await fetch(`${PROFILE_URL}/${encodeURIComponent(lineUserId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    return { kind: "error", status: 0, body: String(e) };
  }

  if (res.status === 200) return { kind: "friend" };

  const body = await res.text().catch(() => "");

  // 404 = 未追加 / ブロック / 同意なし / 存在しないID。届かないので送らない。
  if (res.status === 404) return { kind: "not_friend", status: 404, body };

  // 400 = ID の形式不正（demo: 合成ID など）。何度試しても通らないので専用扱い。
  if (res.status === 400) return { kind: "invalid", status: 400, body };

  // 401/403（トークン・権限）、429（レート/квota）、5xx はすべて一時エラー。
  // ここを not_friend に流すと、こちら側の障害で顧客の行が永久に閉じる。
  return { kind: "error", status: res.status, body };
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
