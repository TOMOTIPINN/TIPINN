import { pushText } from "@/lib/line-messaging";
import {
  attemptClientIp,
  FAILURE_LIMIT,
  WINDOW_MS,
  type Scope,
} from "@/lib/login-attempts";

/**
 * 不正アクセス検知の運営者通知（サーバー専用）。
 * Stripe「セキュリティ対策措置状況申告書」設問6（不正アクセスの検知）への対応。
 *
 * 役割: レート制限（@/lib/login-attempts の isThrottled）が発火したことを、
 * echo 運営者の LINE へ push で知らせる。送信は既存の pushText を使う（新規に API は書かない）。
 *
 * このファイルは **運営者（SECURITY_ALERT_LINE_USER_ID）宛 push の唯一の置き場**。現在3種類:
 *   1. notifyRateLimitHit    … レート制限の発火（不正アクセス検知・上記の申告書対応）
 *   2. notifyQuotaNearLimit  … LINE 配信通数が上限に接近（/api/cron/purge から日次）
 *   3. notifyPushFailures    … 来店リマインドの送信失敗（/api/cron/line-push から実行ごと）
 * 2・3 はセキュリティ事象ではなく**運用アラート**だが、宛先・env 未設定なら無音・例外を投げない
 * という制約が完全に同じなので、置き場を分けずここへ集約する（env とガードを1箇所に保つ）。
 *
 * 方針:
 *  ・**例外を投げない**。通知の失敗で認証フロー側を絶対に壊さない
 *    （pushText / recordAttempt と同じ思想）。失敗は console.warn に status/body を出して握り潰さない。
 *  ・env `SECURITY_ALERT_LINE_USER_ID` 未設定なら**何もせず return**。
 *    ローカル・Preview から運営者へ誤送信するのを防ぐ（本番 env にだけ値を置く）。
 *  ・閾値・集計窓は login-attempts.ts の定数を読む＝数字を2箇所に持たない。
 *
 * ★本文に入れないもの（意図的な除外・変更しないこと）★
 *  ・line_user_id / invite_token / state / 生トークンなどの秘匿値
 *    （通知は LINE のトーク履歴に残り続けるため、ここが漏れると通知自体が攻撃面になる。
 *      login_attempts.detail に秘密値を入れない方針と同じ）。
 *  ・サロン名・スタッフ名・顧客名などの個人／店舗情報
 *    （他社サロンの業務情報が echo 運営者に流れないようにするため。原則7＝個人情報は
 *      echo 一元管理だが、「運営者が業務内容を覗ける」状態は作らない）。
 *  入れてよいのは「いつ・どの種類の入口で・どの IP が・どの閾値に達したか」だけ。
 *  これは運営者が遮断・調査の判断をするのに必要な最小限で、店舗の業務情報を含まない。
 *  ・**例外**: Stripe の payment_intent id（`pi_...`）は載せてよい。運営者が Stripe 側で
 *    手動返金するのに必須の識別子で、これ単体では顧客・サロン・スタッフを特定できない
 *    （個人情報でも秘匿値でもなく、Stripe ダッシュボードの検索キーにすぎない）。
 */

/** 発生時刻の表示（JST・YYYY-MM-DD HH:MM）。基準は他画面（dashboard / inbox）と同じ Asia/Tokyo。 */
const jstStamp = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** scope の日本語ラベル（運営者が一目で入口を判別するため。slug も併記する）。 */
const SCOPE_LABEL: Record<Scope, string> = {
  staff_bind: "スタッフ招待の紐付け",
  line_callback: "LINE ログイン",
  demo_login: "デモログイン",
};

/**
 * レート制限の発火を運営者へ通知する。**例外は投げない**（呼び出し側で await して問題ない）。
 *
 * 引数は `isThrottled(req, scope)` と同じ形にそろえる（発火判定の直後にそのまま呼べる）。
 * IP は login-attempts の attemptClientIp で解決＝**記録された IP と必ず同一の値**になる。
 *
 * @param req   発火したリクエスト（IP は x-forwarded-for から解決）
 * @param scope 発火した入口の種別
 */
export async function notifyRateLimitHit(
  req: Request,
  scope: Scope,
): Promise<void> {
  const to = process.env.SECURITY_ALERT_LINE_USER_ID;
  // 未設定＝通知を使わない環境（ローカル / Preview）。無言で何もしない。
  if (!to) return;

  try {
    const ip = attemptClientIp(req);
    const windowHours = WINDOW_MS / (60 * 60 * 1000);
    const text = [
      "【echo】レート制限が発動しました",
      "",
      `発生時刻: ${jstStamp.format(new Date())}（JST）`,
      `対象: ${SCOPE_LABEL[scope]}（${scope}）`,
      `IP: ${ip}`,
      `閾値: 直近${windowHours}時間に失敗${FAILURE_LIMIT[scope]}回以上`,
      "",
      "同一 IP からの連続失敗を検知し、この入口を一時的にブロックしています。",
    ].join("\n");

    const result = await pushText(to, text);
    if (!result.ok) {
      // 通知が届かないこと自体が検知の穴になるため、必ずログに残す（握り潰さない）。
      console.warn(
        `[security-alert] push failed scope=${scope} status=${result.status} body=${result.body}`,
      );
    }
  } catch (e) {
    console.warn(`[security-alert] push threw scope=${scope}`, e);
  }
}

/**
 * 運営者へ1通 push する共通部。**例外は投げない**／env 未設定なら**無音で return**。
 *
 * notifyRateLimitHit は本文組み立てまで含めて try で包む既存構造をそのまま残したいので
 * この関数を使っていない（ログ書式を含め既存挙動を1文字も変えないため）。新規の通知は
 * すべてここを通す。
 *
 * @param tag  ログに出す識別子（本文ではない）。秘匿値・個人情報を渡さないこと。
 */
async function pushToOperator(tag: string, text: string): Promise<void> {
  const to = process.env.SECURITY_ALERT_LINE_USER_ID;
  // 未設定＝通知を使わない環境（ローカル / Preview）。無言で何もしない。
  if (!to) return;

  try {
    const result = await pushText(to, text);
    if (!result.ok) {
      // 通知が届かないこと自体が検知の穴になるため、必ずログに残す（握り潰さない）。
      console.warn(
        `[security-alert] push failed tag=${tag} status=${result.status} body=${result.body}`,
      );
    }
  } catch (e) {
    console.warn(`[security-alert] push threw tag=${tag}`, e);
  }
}

/**
 * LINE 配信通数が当月上限に接近したことを運営者へ通知する（/api/cron/purge から日次）。
 *
 * **状態を持たない**＝閾値を超えている間は毎日1通届く。既読管理のためのテーブルを
 * 足すより、「毎朝しつこく届く」方が見落としに強い（超過すると顧客への来店リマインドが
 * 丸ごと止まるため、静かに忘れられる方が損失が大きい）。
 *
 * 本文に入れるのは通数と閾値だけ＝顧客・サロンの情報は一切含まない（冒頭の方針どおり）。
 */
export async function notifyQuotaNearLimit(params: {
  totalUsage: number;
  limit: number;
  thresholdRatio: number;
}): Promise<void> {
  const { totalUsage, limit, thresholdRatio } = params;
  const percent = Math.round((totalUsage / limit) * 100);
  const thresholdPercent = Math.round(thresholdRatio * 100);

  const text = [
    "【echo】LINE配信通数が上限に近づいています",
    "",
    `確認時刻: ${jstStamp.format(new Date())}（JST）`,
    `当月の送信数: ${totalUsage.toLocaleString("ja-JP")} / ${limit.toLocaleString("ja-JP")}（${percent}%）`,
    `閾値: 上限の${thresholdPercent}%`,
    "",
    "上限に達すると来店リマインドが届かなくなります。プラン変更を検討してください。",
  ].join("\n");

  await pushToOperator("quota_near_limit", text);
}

/**
 * 来店リマインドの送信失敗を運営者へ通知する（/api/cron/line-push の実行1回につき最大1通）。
 *
 * 渡すのは**件数だけ**。どの顧客・どのサロンかは通知に載せない（冒頭の方針どおり。
 * 調査は notification_outbox を見る＝運営者の LINE トーク履歴に業務情報を残さない）。
 */
export async function notifyPushFailures(count: number): Promise<void> {
  const text = [
    "【echo】LINE通知の送信失敗が発生しました",
    "",
    `発生時刻: ${jstStamp.format(new Date())}（JST）`,
    `失敗件数: ${count}件（直近の cron 実行1回分）`,
    "",
    "notification_outbox の status='failed' を確認してください。",
  ].join("\n");

  await pushToOperator("push_failures", text);
}

/**
 * 同じ感想への有料スタンプ二重決済を運営者へ通知する（0047 の部分一意制約違反・§13 決定5）。
 *
 * 発生経路: /api/checkout の「購入済み」チェックを通過してから webhook が届くまでの数秒間に
 *   2回支払われると、2件目の INSERT が `rating_purchases_review_id_uniq` に衝突する。
 *   echo は**自動返金もロックもしない**（§13 決定5・案Y）。記録を作らずに決済だけが残るので、
 *   運営者が Stripe で手動返金する。Direct Charge のため**返金元はサロンの連結アカウント**。
 *
 * 本文に載せるのは `payment_intent id`（`pi_...`）だけ。
 *   返金にはこの1個があれば足り、顧客名・サロン名・スタッフ名・review_id は要らない
 *   （冒頭の「本文に入れないもの」とその例外を参照）。
 *
 * @param paymentIntentId 返金対象の payment_intent id（`pi_...`）
 */
export async function notifyDuplicateReviewPurchase(
  paymentIntentId: string,
): Promise<void> {
  const text = [
    "【echo】同じ感想への有料スタンプ二重決済を検知しました",
    "",
    `検知時刻: ${jstStamp.format(new Date())}（JST）`,
    `payment: ${paymentIntentId}`,
    "",
    "記録はしていません。Stripe で返金してください（返金元はサロンの連結アカウントです）。",
  ].join("\n");

  await pushToOperator("duplicate_review_purchase", text);
}
