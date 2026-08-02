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
