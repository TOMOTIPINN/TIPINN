/**
 * 日時の表示用フォーマッタ（JST / Asia/Tokyo）。表示専用で、集計・判定には使わない。
 *
 * 店長画面で「いつ届いたか」を同じ書き方で見せるための共有（§20 追加決定・2026-09-22）。
 * /manager/inbox の行と /dashboard の「最近の評価」はどちらもこれを使う。
 */

/**
 * 「M/D HH:mm」（例: `9/20 14:02`・24時間表記）。
 * 別の日の行が混ざっても並び順が読めるよう、時刻だけでなく月日も出す。
 */
export const jstMonthDayTime = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
