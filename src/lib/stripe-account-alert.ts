/**
 * Stripe の連結アカウントの異常を運営者へ通知するかの判定（**純粋な関数だけ**・DB も LINE も触らない）。
 *
 * 背景（`40_decisions.md` §7.2・2026-10-04 決定）:
 *   CARTA の入金の失敗（payouts_enabled は true のままだった）と、suco の提出物の期限切れに
 *   誰も気づかなかった（`60_incidents.md` 2026-10-02）。そこで次の3つだけを運営者の LINE に知らせる。
 *     ア. payout.failed                                         … 種類 payout_failed
 *     イ. account.updated で charges_enabled / payouts_enabled が true → false … 種類 disabled
 *     ウ. account.updated で requirements.past_due が 空 → 空でない         … 種類 requirements
 *         account.updated で requirements.disabled_reason が null → 値あり  … 種類 disabled（イと同じ種類）
 *   通知しないもの: salons に行がない連結アカウント（ログだけ）／false のまま届く account.updated／
 *   currently_due だけが増えた場合／期限の事前通知／サロンのオーナー・店長への通知。
 *
 * 判定をここに分けたのは、DB・LINE を使わずに入力を変えて試せるようにするため
 * （operator-alert-budget.ts と同じ考え方・台本は scripts/check-stripe-account-alert.mjs）。
 * DB の読み書きは login-attempts.ts と webhook、送信は security-alert.ts が持つ。
 */

/** 異常の種類。24時間に1回の判定はこの種類ごと（同じ連結アカウント・同じ種類）。 */
export type StripeIssueKind = "payout_failed" | "disabled" | "requirements";

/**
 * 本文に載せる理由コードだけを持つ。**金額・口座の情報・failure_message・past_due の項目名・
 * 担当者に関する値は持たない**（security-alert.ts の「本文に入れないもの」）。
 */
export type StripeIssue =
  | { kind: "payout_failed"; failureCode: string | null }
  | {
      kind: "disabled";
      /** true → false に変わったフラグ（ウの disabled_reason だけで該当したときは空）。 */
      stopped: ("charges" | "payouts")[];
      disabledReason: string | null;
    }
  | { kind: "requirements"; pastDueCount: number };

/** salons から読んだ（または Stripe から届いた）2つのフラグ。 */
export type AccountFlags = { charges: boolean; payouts: boolean };

/** 同じ連結アカウント・同じ種類への通知の間隔（24時間に1回まで）。 */
export const STRIPE_ISSUE_DEDUP_MS = 24 * 60 * 60 * 1000;

/** login_attempts.detail に入れる識別子（例 `stripe:acct_xxx:payout_failed`）。 */
export function stripeIssueDetail(account: string, kind: StripeIssueKind): string {
  return `stripe:${account}:${kind}`;
}

/**
 * 直近24時間の同じ detail の件数から、今回の通知を止めるか。
 *   1件でもあれば止める。**数えられなかった（null）・不正な値なら止めない＝送る**
 *   （黙って落とさない・2026-10-04 決定。1日10通の上限の対象外なので配信枠の判定とは逆に倒す）。
 */
export function isStripeIssueSuppressed(recentCount: number | null): boolean {
  if (recentCount === null) return false;
  if (!Number.isFinite(recentCount) || recentCount < 0) return false;
  return recentCount > 0;
}

function nonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** past_due が「空」か（null・undefined・空配列）。配列以外の値も空として扱う。 */
function isEmptyList(v: unknown): boolean {
  return !Array.isArray(v) || v.length === 0;
}

function hasOwn(o: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, key);
}

/** ア. payout.failed。salons に行がなければ通知しない（呼び出し側はログだけ出す）。 */
export function decidePayoutFailedIssues(input: {
  salonFound: boolean;
  failureCode: unknown;
}): StripeIssue[] {
  if (!input.salonFound) return [];
  return [{ kind: "payout_failed", failureCode: nonEmptyString(input.failureCode) }];
}

/**
 * イ・ウ. account.updated。
 *
 * @param before salons の上書き前の値（行がなければ null＝通知しない）
 * @param after  届いた account の charges_enabled / payouts_enabled
 * @param requirements 届いた account.requirements（今の値）
 * @param previousRequirements event.data.previous_attributes.requirements（**メモリ上で読むだけ・保存しない**）。
 *   無い（undefined・オブジェクトでない）ときは requirements に変化なし＝ウは通知しない。
 *   中に past_due / disabled_reason のキーが無いときも、その項目は変化なしとして扱う
 *   （previous_attributes には変わった項目だけが入るため）。
 */
export function decideAccountUpdatedIssues(input: {
  before: AccountFlags | null;
  after: AccountFlags;
  requirements: unknown;
  previousRequirements: unknown;
}): StripeIssue[] {
  const { before, after } = input;
  if (before === null) return [];

  // イ: true → false だけ。false のまま届いたもの・false → true は通知しない。
  const stopped: ("charges" | "payouts")[] = [];
  if (before.charges && !after.charges) stopped.push("charges");
  if (before.payouts && !after.payouts) stopped.push("payouts");

  const now =
    input.requirements && typeof input.requirements === "object"
      ? (input.requirements as Record<string, unknown>)
      : {};
  const prev =
    input.previousRequirements && typeof input.previousRequirements === "object"
      ? (input.previousRequirements as Record<string, unknown>)
      : null;

  // ウ: past_due 空 → 空でない（currently_due は見ない）
  const pastDueAppeared =
    prev !== null &&
    hasOwn(prev, "past_due") &&
    isEmptyList(prev.past_due) &&
    !isEmptyList(now.past_due);

  // ウ: disabled_reason null → 値あり
  const disabledReasonNow = nonEmptyString(now.disabled_reason);
  const disabledReasonAppeared =
    prev !== null &&
    hasOwn(prev, "disabled_reason") &&
    nonEmptyString(prev.disabled_reason) === null &&
    disabledReasonNow !== null;

  const issues: StripeIssue[] = [];
  if (stopped.length > 0 || disabledReasonAppeared) {
    issues.push({ kind: "disabled", stopped, disabledReason: disabledReasonNow });
  }
  if (pastDueAppeared) {
    issues.push({
      kind: "requirements",
      pastDueCount: (now.past_due as unknown[]).length,
    });
  }
  return issues;
}

/**
 * 本文の明細行（1種類につき1行）。理由コードだけを載せる。
 * 金額・口座・failure_message・past_due の項目名は**引数にも無い**ので載りようがない。
 */
export function formatStripeIssueLines(issues: StripeIssue[]): string[] {
  return issues.map((issue) => {
    switch (issue.kind) {
      case "payout_failed":
        return `・入金の失敗（failure_code: ${issue.failureCode ?? "なし"}）`;
      case "disabled": {
        const what =
          issue.stopped.length === 0
            ? "停止の理由が付きました"
            : issue.stopped
                .map((f) =>
                  f === "charges"
                    ? "決済の停止（charges_enabled true→false）"
                    : "入金の停止（payouts_enabled true→false）",
                )
                .join("・");
        return `・${what}（disabled_reason: ${issue.disabledReason ?? "なし"}）`;
      }
      case "requirements":
        return `・期限を過ぎた提出物（past_due: ${issue.pastDueCount}件）`;
    }
  });
}
