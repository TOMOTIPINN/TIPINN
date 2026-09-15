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
 * ・送信系のほかに、当月の配信通数を読む GET を2つ持つ（getMessageQuota /
 *   getMessageQuotaConsumption・呼び出し元は /api/cron/purge）。**読み取り専用で通数を
 *   1通も消費しない。** アクセストークンの取り回しをこの1ファイルに閉じるため、
 *   route 側で直接 fetch しない。
 */
const PUSH_URL = "https://api.line.me/v2/bot/message/push";
const PROFILE_URL = "https://api.line.me/v2/bot/profile";
const QUOTA_URL = "https://api.line.me/v2/bot/message/quota";
const QUOTA_CONSUMPTION_URL =
  "https://api.line.me/v2/bot/message/quota/consumption";

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
 *
 * ★本文に「本日」等の時点表現を入れないこと★
 *   notify_at が来店日と別日になる場合（深夜の日またぎ・送信遅延・滞留分の再送）があり、
 *   来店していない日に「本日」と届いてしまうため。
 */
export function buildVisitReviewText(
  salonName: string,
  reviewUrl: string,
): string {
  return [
    `${salonName}です。ご来店ありがとうございました。`,
    "",
    "もしよければ、ご来店の際に気付いた点や担当者へひとことを感想としていただけたら嬉しいです。感想を送ると、感想スタンプが貯まります。",
    "",
    `▽ 感想を送る\n${reviewUrl}`,
  ].join("\n");
}

/**
 * 当月の送信可能通数の上限（GET /v2/bot/message/quota）。
 *   type: "limited" … 上限あり。value = 無料通数 + 追加通数の合計
 *   type: "none"    … 上限未設定（従量など）。接近判定のしようがない
 */
export type MessageQuota =
  | { ok: true; type: "limited"; value: number }
  | { ok: true; type: "none" }
  | { ok: false; status: number; body: string };

/** 当月の送信済み通数（GET /v2/bot/message/quota/consumption）。 */
export type QuotaConsumption =
  | { ok: true; totalUsage: number }
  | { ok: false; status: number; body: string };

/**
 * Messaging API の GET を1本叩いて JSON を返す共通部。**例外は投げない**
 * （pushText / checkFriendship と同じ思想。呼び出し元の cron を止めない）。
 *
 * cache: "no-store" を明示するのは、通数は**毎回必ず実測値でなければ意味がない**ため
 * （フレームワークの既定が将来変わってキャッシュされると、上限接近の検知が静かに死ぬ）。
 */
async function lineGetJson(
  url: string,
): Promise<
  { ok: true; json: unknown } | { ok: false; status: number; body: string }
> {
  const token = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    return { ok: false, status: 0, body: "missing_access_token" };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, status: 0, body: String(e) };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, status: res.status, body };
  }

  try {
    return { ok: true, json: await res.json() };
  } catch (e) {
    return { ok: false, status: res.status, body: `invalid_json: ${String(e)}` };
  }
}

/**
 * 当月の送信可能通数の上限を取る（読み取り専用・通数を消費しない）。
 *
 * 想定外のレスポンス形（type が none/limited 以外・value 欠落）は **ok:false** に倒す。
 * ここを黙って 0 や NaN で通すと、比較が常に成立して毎日アラートが出続ける。
 */
export async function getMessageQuota(): Promise<MessageQuota> {
  const r = await lineGetJson(QUOTA_URL);
  if (!r.ok) return r;

  const j = r.json as { type?: unknown; value?: unknown };
  if (j.type === "limited" && typeof j.value === "number") {
    return { ok: true, type: "limited", value: j.value };
  }
  if (j.type === "none") return { ok: true, type: "none" };

  return {
    ok: false,
    status: 200,
    body: `unexpected_body: ${JSON.stringify(j)}`,
  };
}

/** 当月の送信済み通数を取る（読み取り専用・通数を消費しない）。 */
export async function getMessageQuotaConsumption(): Promise<QuotaConsumption> {
  const r = await lineGetJson(QUOTA_CONSUMPTION_URL);
  if (!r.ok) return r;

  const j = r.json as { totalUsage?: unknown };
  if (typeof j.totalUsage === "number") {
    return { ok: true, totalUsage: j.totalUsage };
  }

  return {
    ok: false,
    status: 200,
    body: `unexpected_body: ${JSON.stringify(j)}`,
  };
}
