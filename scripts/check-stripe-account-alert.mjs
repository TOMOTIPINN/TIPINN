/**
 * Stripe の連結アカウントの異常の通知判定（src/lib/stripe-account-alert.ts）をローカルで確かめる台本。
 * DB も LINE も Stripe も使わない（本番の DB に試験用の行を入れない・stripe コマンドも使わない）。
 *
 * 実行: node --experimental-strip-types scripts/check-stripe-account-alert.mjs
 *   1つでも期待と違えば例外で止まる（終了コード 1）。全部通れば最後に "OK" を出す。
 *
 * ※ check-operator-alert-budget.mjs と同じく型注釈の無い .mjs にしてある。
 */
import assert from "node:assert/strict";
import {
  STRIPE_ISSUE_DEDUP_MS,
  decideAccountUpdatedIssues,
  decidePayoutFailedIssues,
  formatStripeIssueLines,
  isStripeIssueSuppressed,
  stripeIssueDetail,
} from "../src/lib/stripe-account-alert.ts";
import { isCappedAlert } from "../src/lib/operator-alert-budget.ts";

const ON = { charges: true, payouts: true };
const OFF = { charges: false, payouts: false };
const kinds = (issues) => issues.map((i) => i.kind);

// ── 上限の対象外（2026-10-04 決定）────────────────────────
assert.equal(isCappedAlert("stripe_account_issue"), false);

// ── ア. payout.failed ─────────────────────────────────
assert.deepEqual(decidePayoutFailedIssues({ salonFound: true, failureCode: "account_closed" }), [
  { kind: "payout_failed", failureCode: "account_closed" },
]);
assert.deepEqual(decidePayoutFailedIssues({ salonFound: true, failureCode: null }), [
  { kind: "payout_failed", failureCode: null },
]);
// salons に行がないと通知しない
assert.deepEqual(decidePayoutFailedIssues({ salonFound: false, failureCode: "account_closed" }), []);

// ── イ. true → false ──────────────────────────────────
assert.deepEqual(
  decideAccountUpdatedIssues({ before: ON, after: { charges: false, payouts: true }, requirements: {}, previousRequirements: undefined }),
  [{ kind: "disabled", stopped: ["charges"], disabledReason: null }],
);
assert.deepEqual(
  decideAccountUpdatedIssues({ before: ON, after: OFF, requirements: { disabled_reason: "requirements.past_due" }, previousRequirements: undefined }),
  [{ kind: "disabled", stopped: ["charges", "payouts"], disabledReason: "requirements.past_due" }],
);
// false → false は通知しない（false のまま届く account.updated）
assert.deepEqual(decideAccountUpdatedIssues({ before: OFF, after: OFF, requirements: {}, previousRequirements: undefined }), []);
// false → true・true → true も通知しない
assert.deepEqual(decideAccountUpdatedIssues({ before: OFF, after: ON, requirements: {}, previousRequirements: undefined }), []);
assert.deepEqual(decideAccountUpdatedIssues({ before: ON, after: ON, requirements: {}, previousRequirements: undefined }), []);
// salons に行がないと通知しない（true → false 相当の値が届いても）
assert.deepEqual(
  decideAccountUpdatedIssues({
    before: null,
    after: OFF,
    requirements: { past_due: ["x"], disabled_reason: "y" },
    previousRequirements: { past_due: [], disabled_reason: null },
  }),
  [],
);

// ── ウ. past_due 空 → 空でない ─────────────────────────
assert.deepEqual(
  decideAccountUpdatedIssues({ before: ON, after: ON, requirements: { past_due: ["a", "b"] }, previousRequirements: { past_due: [] } }),
  [{ kind: "requirements", pastDueCount: 2 }],
);
assert.deepEqual(
  decideAccountUpdatedIssues({ before: OFF, after: OFF, requirements: { past_due: ["a"] }, previousRequirements: { past_due: null } }),
  [{ kind: "requirements", pastDueCount: 1 }],
);
// 空でない → 空でない（項目が増えた）・空でない → 空 は通知しない
assert.deepEqual(decideAccountUpdatedIssues({ before: ON, after: ON, requirements: { past_due: ["a", "b"] }, previousRequirements: { past_due: ["a"] } }), []);
assert.deepEqual(decideAccountUpdatedIssues({ before: ON, after: ON, requirements: { past_due: [] }, previousRequirements: { past_due: ["a"] } }), []);
// previous_attributes に requirements が無いと通知しない（今の past_due が空でなくても）
assert.deepEqual(decideAccountUpdatedIssues({ before: ON, after: ON, requirements: { past_due: ["a"] }, previousRequirements: undefined }), []);
assert.deepEqual(decideAccountUpdatedIssues({ before: ON, after: ON, requirements: { past_due: ["a"] }, previousRequirements: null }), []);
// requirements はあるが past_due のキーが無い＝past_due は変わっていない → 通知しない
assert.deepEqual(decideAccountUpdatedIssues({ before: ON, after: ON, requirements: { past_due: ["a"] }, previousRequirements: { currently_due: [] } }), []);
// currently_due だけが増えた場合は通知しない
assert.deepEqual(
  decideAccountUpdatedIssues({ before: ON, after: ON, requirements: { currently_due: ["a"], past_due: [] }, previousRequirements: { currently_due: [] } }),
  [],
);

// ── ウ. disabled_reason null → 値あり（種類は disabled）───────
assert.deepEqual(
  decideAccountUpdatedIssues({ before: OFF, after: OFF, requirements: { disabled_reason: "requirements.past_due" }, previousRequirements: { disabled_reason: null } }),
  [{ kind: "disabled", stopped: [], disabledReason: "requirements.past_due" }],
);
// 値あり → 別の値・キーが無い は通知しない
assert.deepEqual(decideAccountUpdatedIssues({ before: OFF, after: OFF, requirements: { disabled_reason: "b" }, previousRequirements: { disabled_reason: "a" } }), []);
assert.deepEqual(decideAccountUpdatedIssues({ before: OFF, after: OFF, requirements: { disabled_reason: "b" }, previousRequirements: { past_due: ["x"] } }), []);

// ── 1つのイベントで複数に該当（イ＋ウ）→ 種類ごとに1件ずつ（本文は1通にまとめる）─
const both = decideAccountUpdatedIssues({
  before: ON,
  after: { charges: false, payouts: true },
  requirements: { past_due: ["a", "b", "c"], disabled_reason: "requirements.past_due" },
  previousRequirements: { past_due: [], disabled_reason: null },
});
assert.deepEqual(kinds(both), ["disabled", "requirements"]); // イとウの disabled_reason は同じ disabled に1件
assert.deepEqual(both[0], { kind: "disabled", stopped: ["charges"], disabledReason: "requirements.past_due" });

// ── 24時間に1回 ─────────────────────────────────────
assert.equal(STRIPE_ISSUE_DEDUP_MS, 24 * 60 * 60 * 1000);
assert.equal(stripeIssueDetail("acct_123", "payout_failed"), "stripe:acct_123:payout_failed");
assert.equal(isStripeIssueSuppressed(0), false);
assert.equal(isStripeIssueSuppressed(1), true);
assert.equal(isStripeIssueSuppressed(5), true);
// 読み取りに失敗（null）・不正な値は送る（黙って落とさない）
assert.equal(isStripeIssueSuppressed(null), false);
assert.equal(isStripeIssueSuppressed(Number.NaN), false);
assert.equal(isStripeIssueSuppressed(-1), false);

// ── 本文の明細行（理由コードだけ。項目名・金額は載らない）────────
const lines = formatStripeIssueLines([
  { kind: "payout_failed", failureCode: "account_closed" },
  ...both,
]);
assert.deepEqual(lines, [
  "・入金の失敗（failure_code: account_closed）",
  "・決済の停止（charges_enabled true→false）（disabled_reason: requirements.past_due）",
  "・期限を過ぎた提出物（past_due: 3件）",
]);
assert.ok(!lines.join("\n").includes('"a"'), "past_due の項目名を載せない");
assert.deepEqual(formatStripeIssueLines([{ kind: "disabled", stopped: [], disabledReason: null }]), [
  "・停止の理由が付きました（disabled_reason: なし）",
]);
assert.deepEqual(formatStripeIssueLines([{ kind: "disabled", stopped: ["charges", "payouts"], disabledReason: null }]), [
  "・決済の停止（charges_enabled true→false）・入金の停止（payouts_enabled true→false）（disabled_reason: なし）",
]);

console.log("OK");
