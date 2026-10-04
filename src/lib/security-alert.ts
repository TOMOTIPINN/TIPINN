import { pushText } from "@/lib/line-messaging";
import {
  attemptClientIp,
  countCappedOperatorAlertsSince,
  countRecentRateLimitAlerts,
  countUncappedOperatorAlertsByDetailSince,
  FAILURE_LIMIT,
  recordOperatorAlert,
  WINDOW_MS,
  type OperatorAlertScope,
  type Scope,
} from "@/lib/login-attempts";
import {
  formatStripeIssueLines,
  isStripeIssueSuppressed,
  STRIPE_ISSUE_DEDUP_MS,
  stripeIssueDetail,
  type StripeIssue,
} from "@/lib/stripe-account-alert";
import {
  decideOperatorAlert,
  isCappedAlert,
  isRateLimitAlertSuppressed,
  jstDayStartMs,
  withLastNote,
  type OperatorAlertKind,
} from "@/lib/operator-alert-budget";

/**
 * 不正アクセス検知の運営者通知（サーバー専用）。
 * Stripe「セキュリティ対策措置状況申告書」設問6（不正アクセスの検知）への対応。
 *
 * 役割: レート制限（@/lib/login-attempts の isThrottled）が発火したことを、
 * echo 運営者の LINE へ push で知らせる。送信は既存の pushText を使う（新規に API は書かない）。
 *
 * このファイルは **運営者（SECURITY_ALERT_LINE_USER_ID）宛 push の唯一の置き場**。現在5種類:
 *   1. notifyRateLimitHit    … レート制限の発火（不正アクセス検知・上記の申告書対応）
 *   2. notifyQuotaNearLimit  … LINE 配信通数が上限に接近（/api/cron/purge から日次）
 *   3. notifyPushFailures    … 来店リマインドの送信失敗（/api/cron/line-push から実行ごと）
 *   4. notifyDuplicateReviewPurchase … 同じ感想への有料スタンプ二重決済（/api/stripe/webhook/connect）
 *   5. notifyStripeAccountIssues     … Stripe の連結アカウントの異常（/api/stripe/webhook/connect・2026-10-04 決定）
 * 2〜5 はセキュリティ事象ではなく**運用アラート**だが、宛先・env 未設定なら無音・例外を投げない
 * という制約が完全に同じなので、置き場を分けずここへ集約する（env とガードを1箇所に保つ）。
 *
 * 方針:
 *  ・**例外を投げない**。通知の失敗で認証フロー側を絶対に壊さない
 *    （pushText / recordAttempt と同じ思想）。失敗は console.warn に status/body を出して握り潰さない。
 *  ・env `SECURITY_ALERT_LINE_USER_ID` 未設定なら**何もせず return**。
 *    ローカル・Preview から運営者へ誤送信するのを防ぐ（本番 env にだけ値を置く）。
 *  ・閾値・集計窓は login-attempts.ts の定数を読む＝数字を2箇所に持たない。
 *  ・★通数の上限（`50_security.md` §5-7・2026-10-01 決定）★
 *    運営者への通知はお客様への来店リマインドと**同じ Messaging チャネル＝同じ月の配信枠**を使う
 *    （ライトプラン月5,000通・超えると送信が止まる）。そこで、
 *      B. レート制限の通知は、同じ scope・同じ IP に直近1時間で通知済みなら送らない
 *      C. **上限の対象の通知（レート制限・push 失敗）**を合わせて JST の1日10通まで（10通目の本文に止める旨を添える）
 *         **二重決済・配信数の警告は上限の対象外**（攻撃者がタダで増やせず、止まると困るため）。
 *         どの種類が対象かは @/lib/operator-alert-budget の OperatorAlertKind に一覧と理由がある。
 *    送るたびに login_attempts へ1行記録し、その件数で判定する（対象外の種類も記録はするが数えない）。
 *    判定は @/lib/operator-alert-budget の純粋な関数、読み書きは login-attempts.ts。
 *    **判定・記録で DB に失敗したら、上限の対象の通知は送らない**（2026-10-01 決定・配信枠を守る側）。
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
 *  ・**例外（2026-10-04 追加）**: Stripe の連結アカウント ID（`acct_...`）も、`pi_...` と同じ理由で載せてよい。
 *    運営者が Stripe ダッシュボードで該当の連結アカウントを開くのに必須の識別子で、これ単体では
 *    顧客・スタッフを特定できない（個人情報でも秘匿値でもなく、ダッシュボードの検索キーにすぎない）。
 *    サロン名は引き続き載せない（どの店かは運営者が `40_decisions.md` §7.3 の対応表で引く）。
 *    Stripe の通知でも、金額・口座の情報・failure_message・past_due の項目名・担当者に関する値は載せない。
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
  owner_join: "オーナー招待の使用",
};

/**
 * レート制限の発火を運営者へ通知する。**例外は投げない**（呼び出し側で await して問題ない）。
 *
 * 引数は `isThrottled(req, scope)` と同じ形にそろえる（発火判定の直後にそのまま呼べる）。
 * IP は login-attempts の attemptClientIp で解決＝**記録された IP と必ず同一の値**になる。
 *
 * ★1日の上限の対象★（攻撃者が IP を変えれば増やせるため）。加えて同じ scope・IP には1時間に1回まで。
 *
 * @param req   発火したリクエスト（IP は x-forwarded-for から解決）
 * @param scope 発火した入口の種別
 */
export async function notifyRateLimitHit(
  req: Request,
  scope: Scope,
): Promise<void> {
  const to = process.env.SECURITY_ALERT_LINE_USER_ID;
  // 未設定＝通知を使わない環境（ローカル / Preview）。無言で何もしない（DB も引かない）。
  if (!to) return;

  try {
    // B: 同じ scope・同じ IP に直近1時間で通知済みなら送らない。
    //   止められたリクエストは recordAttempt されないので、何もしないと止まっている間
    //   リクエストのたびに1通ずつ送られていた（2026-10-01 に判明）。
    //   数えられなかった（DB の失敗）ときは送らない（2026-10-01 決定）。
    const recent = await countRecentRateLimitAlerts(req, scope);
    if (recent === null) {
      console.warn(`[security-alert] skipped tag=rate_limit:${scope} reason=db_error`);
      return;
    }
    if (isRateLimitAlertSuppressed(recent)) return;

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
      `同じ入口・同じ IP への通知は${windowHours}時間に1回までです。`,
    ].join("\n");

    await sendOperatorAlert("rate_limit", `rate_limit:${scope}`, text, {
      scope: "rate_limit_alert",
      detail: scope,
      req,
    });
  } catch (e) {
    console.warn(`[security-alert] push threw tag=rate_limit:${scope}`, e);
  }
}

/**
 * 運営者への通知すべての共通の出口。
 *
 * ・**上限の対象外**（二重決済・配信数の警告）: 本日の通数に関係なく送る。記録は残すが
 *   （scope operator_alert_uncapped）上限の件数には数えない。記録に失敗しても送る。
 * ・**上限の対象**（レート制限・push 失敗）: 本日（JST）の対象の通数を数える → 上限なら送らない →
 *   記録を1行入れる → 送る。数えられない・記録できない（DB の失敗）ときは送らない（2026-10-01 決定）。
 *   記録を送信より先に入れるのは、同時に来た通知どうしで通数を数え漏らしにくくするため
 *   （送信に失敗しても1通分として数える＝枠を守る側に倒す）。
 * **例外は投げない**（呼び出し側の try の中で呼ぶ）。env 未設定は呼び出し側で return 済み。
 */
async function sendOperatorAlert(
  kind: OperatorAlertKind,
  logTag: string,
  text: string,
  record: {
    scope: OperatorAlertScope;
    detail: string;
    /**
     * 上限の対象外で、1通に複数の種類をまとめたときの残りの detail（Stripe の連結アカウントの異常）。
     * 24時間に1回の判定が種類ごとなので、種類ごとに1行ずつ記録する。上限の対象では使わない。
     */
    extraDetails?: readonly string[];
    req?: Request;
  },
): Promise<void> {
  const to = process.env.SECURITY_ALERT_LINE_USER_ID;
  if (!to) return;

  let isLast = false;
  if (!isCappedAlert(kind)) {
    // 上限の対象外。記録は best effort（失敗しても送る）。
    for (const detail of [record.detail, ...(record.extraDetails ?? [])]) {
      await recordOperatorAlert("operator_alert_uncapped", detail, record.req);
    }
  } else {
    const sentToday = await countCappedOperatorAlertsSince(
      new Date(jstDayStartMs(Date.now())).toISOString(),
    );
    const decision = decideOperatorAlert(kind, sentToday);
    if (!decision.send) {
      const reason = sentToday === null ? "db_error" : "daily_limit";
      console.warn(`[security-alert] skipped tag=${logTag} reason=${reason}`);
      return;
    }
    isLast = decision.isLast;

    const recorded = await recordOperatorAlert(record.scope, record.detail, record.req);
    if (!recorded) {
      // 記録できないまま送ると通数が数えられず、上限が効かなくなる。
      console.warn(`[security-alert] skipped tag=${logTag} reason=record_failed`);
      return;
    }
  }

  const result = await pushText(to, withLastNote(text, isLast));
  if (!result.ok) {
    // 通知が届かないこと自体が検知の穴になるため、必ずログに残す（握り潰さない）。
    console.warn(
      `[security-alert] push failed tag=${logTag} status=${result.status} body=${result.body}`,
    );
  }
}

/**
 * 運営者へ1通 push する共通部。**例外は投げない**／env 未設定なら**無音で return**。
 *
 * notifyRateLimitHit はこの関数を通らない（B の判定と IP の記録があるため）が、
 * 出口は同じ sendOperatorAlert。**上限の対象かどうかは kind で決まる**（operator-alert-budget.ts の一覧）。
 * 新規の通知はすべてここを通し、OperatorAlertKind に種類を足して対象かどうかを決めること。
 *
 * @param kind 通知の種類（ログの識別子と記録の detail にも使う）。秘匿値・個人情報ではない。
 */
async function pushToOperator(
  kind: Exclude<OperatorAlertKind, "rate_limit">,
  text: string,
): Promise<void> {
  const to = process.env.SECURITY_ALERT_LINE_USER_ID;
  // 未設定＝通知を使わない環境（ローカル / Preview）。無言で何もしない（DB も引かない）。
  if (!to) return;

  try {
    // 上限の対象（push_failures）は notifyRateLimitHit と合わせて数える。対象外は数えずに送る。
    await sendOperatorAlert(kind, kind, text, { scope: "operator_alert", detail: kind });
  } catch (e) {
    console.warn(`[security-alert] push threw tag=${kind}`, e);
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
 *
 * ★1日の上限の対象外★（1日1通しか出ず、止まると配信枠の警告そのものが届かなくなるため）。
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
 *
 * ★1日の上限の対象★（10分ごとの cron で最大1日144通になり得るため）。
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
 * ★1日の上限の対象外★（実際の支払いが要るので攻撃者がタダで増やせず、止まると返金のきっかけを失うため）。
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

/**
 * Stripe の連結アカウントの異常を運営者へ通知する（/api/stripe/webhook/connect から・2026-10-04 決定）。
 *
 * 何を異常とするか（ア・イ・ウ）は @/lib/stripe-account-alert の純粋な関数が決め、ここには
 * 該当した種類だけが渡る。**1つのイベントで複数の種類に該当したら1通にまとめる。**
 *
 * ★1日の上限の対象外★（Stripe の署名付き webhook からしか出ず、止まると入金の失敗に気づけないため）。
 * 代わりに、**同じ連結アカウント・同じ種類は24時間に1回まで**:
 *   送る前に login_attempts の直近24時間を detail `stripe:<acct_id>:<種類>` で数え、あればその種類を外す。
 *   **数えられなかった（DB の失敗）ときは送る**（黙って落とさない・2026-10-04 決定）。
 *   記録に失敗しても送る（既存の対象外の通知と同じ）。
 *
 * 本文に入れるのは種類・`acct_...`・理由コード（failure_code／disabled_reason／past_due の件数）だけ
 * （冒頭の「本文に入れないもの」とその例外を参照）。**例外は投げない**（webhook の応答を失敗させない）。
 *
 * @param account 連結アカウント ID（`acct_...`）
 * @param issues  判定で該当した異常（空なら何もしない）
 */
export async function notifyStripeAccountIssues(
  account: string,
  issues: StripeIssue[],
): Promise<void> {
  const to = process.env.SECURITY_ALERT_LINE_USER_ID;
  // 未設定＝通知を使わない環境（ローカル / Preview）。無言で何もしない（DB も引かない）。
  if (!to || issues.length === 0) return;

  try {
    const since = new Date(Date.now() - STRIPE_ISSUE_DEDUP_MS).toISOString();
    const fresh: StripeIssue[] = [];
    for (const issue of issues) {
      const detail = stripeIssueDetail(account, issue.kind);
      const recent = await countUncappedOperatorAlertsByDetailSince(detail, since);
      if (recent === null) {
        console.warn(`[security-alert] dedup read failed tag=${detail} (send anyway)`);
      }
      if (isStripeIssueSuppressed(recent)) continue;
      fresh.push(issue);
    }
    if (fresh.length === 0) return;

    const text = [
      "【echo】Stripe の連結アカウントに異常があります",
      "",
      `検知時刻: ${jstStamp.format(new Date())}（JST）`,
      `連結アカウント: ${account}`,
      ...formatStripeIssueLines(fresh),
      "",
      "Stripe ダッシュボードでこの連結アカウントを開いて確認してください。",
      "同じアカウント・同じ種類の通知は24時間に1回までです。",
    ].join("\n");

    const [first, ...rest] = fresh.map((i) => stripeIssueDetail(account, i.kind));
    await sendOperatorAlert("stripe_account_issue", first, text, {
      scope: "operator_alert_uncapped",
      detail: first,
      extraDetails: rest,
    });
  } catch (e) {
    console.warn(`[security-alert] push threw tag=stripe_account_issue:${account}`, e);
  }
}
