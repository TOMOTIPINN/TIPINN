/**
 * 運営者への LINE 通知の「送るかどうか」の判定（**純粋な関数だけ**・DB も LINE も触らない）。
 *
 * 背景（`50_security.md` §5-7・2026-10-01 決定）:
 *   運営者への通知はお客様への来店リマインドと**同じ Messaging チャネル**（同じ月の配信枠）を使う。
 *   LINE はライトプラン（月5,000通・超えると送信が止まる）なので、運営者への通知が膨らむと
 *   **お客様への通知が止まる**。そこで次の2つで通数を抑える。
 *     B. レート制限の通知は、同じ scope・同じ IP に直近1時間で通知済みなら送らない
 *     C. 上限の対象の通知（レート制限・push 失敗）を合わせて、**JST の1日10通まで**
 *        （二重決済・配信数の警告・Stripe の連結アカウントの異常は対象外＝下の OperatorAlertKind のコメント）
 *
 * 判定をここに分けたのは、DB・LINE を使わずに入力を変えて試せるようにするため
 * （本番の DB に試験用の行を入れない・2026-10-01 決定）。DB の読み書きは login-attempts.ts、
 * 送信は security-alert.ts が持つ。
 */

/**
 * 運営者への通知の種類。
 *
 * ★1日の上限の対象かどうか（2026-10-01 決定）★
 *   上限の対象（CAPPED）:
 *     ・rate_limit     … レート制限の通知（notifyRateLimitHit）。攻撃者が IP を変えれば増やせる
 *     ・push_failures  … 来店リマインドの送信失敗（notifyPushFailures）。10分ごとの cron で最大1日144通
 *   上限の対象外（UNCAPPED）＝上限に達していても送る・件数にも数えない:
 *     ・duplicate_review_purchase … 二重決済（notifyDuplicateReviewPurchase）。
 *         実際の支払いが要るので攻撃者がタダで増やせない。止まると返金のきっかけを失う
 *     ・quota_near_limit          … 配信数の警告（notifyQuotaNearLimit）。1日1通しか出ない。
 *         止まると配信枠の警告そのものが届かなくなる
 *     ・stripe_account_issue      … Stripe の連結アカウントの異常（notifyStripeAccountIssues・2026-10-04 決定）。
 *         Stripe の署名付き webhook からしか出ないので攻撃者が増やせない。止まると入金の失敗・
 *         提出物の期限切れに気づけない（`60_incidents.md` 2026-10-02）。代わりに、同じ連結アカウント・
 *         同じ種類は24時間に1回まで（判定は @/lib/stripe-account-alert）
 */
export type OperatorAlertKind =
  | "rate_limit"
  | "push_failures"
  | "duplicate_review_purchase"
  | "quota_near_limit"
  | "stripe_account_issue";

/** 上限の対象かどうか（一覧はここだけ。理由は上の型のコメント）。 */
const IS_CAPPED: Record<OperatorAlertKind, boolean> = {
  rate_limit: true,
  push_failures: true,
  duplicate_review_purchase: false,
  quota_near_limit: false,
  stripe_account_issue: false,
};

/** 1日の上限の対象か。 */
export function isCappedAlert(kind: OperatorAlertKind): boolean {
  return IS_CAPPED[kind];
}

/** 運営者への通知の1日の上限（上限の対象の種類の合計・JST の日付で数える）。 */
export const OPERATOR_ALERT_DAILY_LIMIT = 10;

/** 上限に達する通知（その日の最後の1通）の本文に添える文。 */
export const OPERATOR_ALERT_LAST_NOTE =
  "本日の運営者への通知はここで止めます。続きは login_attempts などを確認してください。";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** nowMs を含む JST の日付の 0:00 を、UTC のエポックミリ秒で返す。 */
export function jstDayStartMs(nowMs: number): number {
  return Math.floor((nowMs + JST_OFFSET_MS) / DAY_MS) * DAY_MS - JST_OFFSET_MS;
}

export type DailyDecision =
  | { send: false }
  | { send: true; isLast: boolean };

/**
 * C: 本日すでに送った通数から、今回送るかを決める。
 *   sentToday < limit なら送る。送ったあとにちょうど limit に達する1通（sentToday === limit-1）は isLast。
 *   不正な値（負数・NaN）は送らない側に倒す（通数を守るため）。
 */
export function decideDailyAlert(
  sentToday: number,
  limit: number = OPERATOR_ALERT_DAILY_LIMIT,
): DailyDecision {
  if (!Number.isFinite(sentToday) || sentToday < 0) return { send: false };
  if (sentToday >= limit) return { send: false };
  return { send: true, isLast: sentToday === limit - 1 };
}

/**
 * 種類ごとの判定。上限の対象外なら、本日の通数（null＝DB で数えられなかった場合を含む）に関係なく送る。
 * 上限の対象は decideDailyAlert に従う。数えられなかった（null）ときは送らない（2026-10-01 決定・案1）。
 */
export function decideOperatorAlert(
  kind: OperatorAlertKind,
  sentToday: number | null,
  limit: number = OPERATOR_ALERT_DAILY_LIMIT,
): DailyDecision {
  if (!isCappedAlert(kind)) return { send: true, isLast: false };
  if (sentToday === null) return { send: false };
  return decideDailyAlert(sentToday, limit);
}

/**
 * B: 同じ scope・同じ IP への直近の通知件数から、今回のレート制限の通知を止めるか。
 *   1件でもあれば止める。不正な値は止める側に倒す。
 */
export function isRateLimitAlertSuppressed(recentAlertCount: number): boolean {
  if (!Number.isFinite(recentAlertCount) || recentAlertCount < 0) return true;
  return recentAlertCount > 0;
}

/** 最後の1通なら本文に一文を添える。 */
export function withLastNote(text: string, isLast: boolean): string {
  return isLast ? `${text}\n\n${OPERATOR_ALERT_LAST_NOTE}` : text;
}
