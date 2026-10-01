/**
 * 運営者への LINE 通知の判定（src/lib/operator-alert-budget.ts）をローカルで確かめる台本。
 * DB も LINE も使わない（本番の DB に試験用の行を入れない・2026-10-01 決定）。
 *
 * 実行: node --experimental-strip-types scripts/check-operator-alert-budget.mjs
 *   1つでも期待と違えば例外で止まる（終了コード 1）。全部通れば最後に "OK" を出す。
 *
 * ※ 型注釈の無い .mjs にしてある（.mts だと tsc の対象になり、.ts 拡張子付きの import で型エラーになる）。
 *   --experimental-strip-types は読み込む先の operator-alert-budget.ts の型を外すために要る。
 */
import assert from "node:assert/strict";
import {
  OPERATOR_ALERT_DAILY_LIMIT,
  OPERATOR_ALERT_LAST_NOTE,
  decideDailyAlert,
  decideOperatorAlert,
  isCappedAlert,
  isRateLimitAlertSuppressed,
  jstDayStartMs,
  withLastNote,
} from "../src/lib/operator-alert-budget.ts";

const iso = (ms) => new Date(ms).toISOString();

// ── JST の日付の 0:00 ─────────────────────────────────
assert.equal(iso(jstDayStartMs(Date.parse("2026-10-01T14:59:59Z"))), "2026-09-30T15:00:00.000Z"); // 10/1 23:59:59 JST
assert.equal(iso(jstDayStartMs(Date.parse("2026-10-01T15:00:00Z"))), "2026-10-01T15:00:00.000Z"); // 10/2 0:00 JST
assert.equal(iso(jstDayStartMs(Date.parse("2026-10-01T00:00:00Z"))), "2026-09-30T15:00:00.000Z");
assert.equal(iso(jstDayStartMs(Date.parse("2026-09-30T15:00:00Z"))), "2026-09-30T15:00:00.000Z");

// ── 1日の上限（上限の対象）────────────────────────────
assert.equal(OPERATOR_ALERT_DAILY_LIMIT, 10);
assert.deepEqual(decideDailyAlert(0), { send: true, isLast: false });
assert.deepEqual(decideDailyAlert(8), { send: true, isLast: false });
assert.deepEqual(decideDailyAlert(9), { send: true, isLast: true });
assert.deepEqual(decideDailyAlert(10), { send: false });
assert.deepEqual(decideDailyAlert(11), { send: false });
assert.deepEqual(decideDailyAlert(-1), { send: false });
assert.deepEqual(decideDailyAlert(Number.NaN), { send: false });

// ── 上限の対象かどうか（2026-10-01 決定）───────────────
assert.equal(isCappedAlert("rate_limit"), true);
assert.equal(isCappedAlert("push_failures"), true);
assert.equal(isCappedAlert("duplicate_review_purchase"), false);
assert.equal(isCappedAlert("quota_near_limit"), false);

// 上限の対象: 上限に達したら送らない／数えられない（DB の失敗＝null）なら送らない
for (const kind of ["rate_limit", "push_failures"]) {
  assert.deepEqual(decideOperatorAlert(kind, 9), { send: true, isLast: true });
  assert.deepEqual(decideOperatorAlert(kind, 10), { send: false });
  assert.deepEqual(decideOperatorAlert(kind, null), { send: false });
}

// ★外した2種類は、上限に達していても（数えられなくても）送られる★
for (const kind of ["duplicate_review_purchase", "quota_near_limit"]) {
  for (const sentToday of [0, 9, 10, 11, 100, null]) {
    assert.deepEqual(
      decideOperatorAlert(kind, sentToday),
      { send: true, isLast: false },
      `${kind} sentToday=${sentToday}`,
    );
  }
}

// 1日のシミュレーション: 上限の対象15件の合間に対象外が来ても、対象外は全部送られ、
// 対象は10件で止まる（対象外は件数に数えない）。
{
  let cappedSent = 0;
  const sentKinds = [];
  const stream = [
    ...Array.from({ length: 12 }, () => "rate_limit"),
    "duplicate_review_purchase",
    ...Array.from({ length: 3 }, () => "push_failures"),
    "quota_near_limit",
  ];
  for (const kind of stream) {
    const d = decideOperatorAlert(kind, cappedSent);
    if (!d.send) continue;
    sentKinds.push(kind);
    if (isCappedAlert(kind)) cappedSent++;
  }
  assert.equal(cappedSent, 10);
  assert.equal(sentKinds.filter((k) => k === "duplicate_review_purchase").length, 1);
  assert.equal(sentKinds.filter((k) => k === "quota_near_limit").length, 1);
  assert.equal(sentKinds.length, 12);
}

// ── 同じ scope・IP への1時間に1回 ───────────────────────
assert.equal(isRateLimitAlertSuppressed(0), false);
assert.equal(isRateLimitAlertSuppressed(1), true);
assert.equal(isRateLimitAlertSuppressed(3), true);
assert.equal(isRateLimitAlertSuppressed(-1), true);
assert.equal(isRateLimitAlertSuppressed(Number.NaN), true);

// ── 最後の1通の一文 ─────────────────────────────────
assert.equal(withLastNote("本文", false), "本文");
assert.equal(withLastNote("本文", true), `本文\n\n${OPERATOR_ALERT_LAST_NOTE}`);

console.log("OK");
