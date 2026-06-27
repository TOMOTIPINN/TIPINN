/**
 * 来店スタンプの「循環型」進捗ロジック（来店軸 / Phase 7・CLAUDE.md §4 / migration 0009）。
 *
 * サロンごと（顧客 × サロン単位）の累計来店回数 count から、
 * サイクル内進捗・次の特典までの残数を導出する純粋関数。vip.ts（感想軸）と同型。
 * 表示側（/mypage の来店ゲージ等）で再利用する。DB には一切依存しない。
 *
 * 仕様:
 * - 1サイクル = 来店 cycleSize 回（= 来店特典の発動単位。サロンごと可変・既定20・10〜20）。
 * - cycleSize 回たまるたびに特典が発動し、サイクル内カウントは 0 に戻って再カウント（表示上のみ）。
 * - 累計 count はリセットしない（21,22… と伸び続ける）。「0に戻る」のは表示上のサイクルだけ。
 *
 * ⚠️ サイクル幅は感想軸（CYCLE_SIZE=3固定）とは別。来店軸は salons.visit_cycle_size を渡す。
 */

export type VisitProgress = {
  /** 累計来店回数（顧客 × サロン）。リセットされない累積値。 */
  count: number;
  /** サイクル幅（= 特典発動に必要な来店回数）。salons.visit_cycle_size 由来。 */
  cycleSize: number;
  /** 現サイクルの進捗 0〜cycleSize-1。ゲージの点灯数に使う。 */
  progressInCycle: number;
  /** 次の特典まであと何回（1〜cycleSize）。 */
  toNextPerk: number;
  /** 特典発動回数 = floor(count / cycleSize)。 */
  cyclesCompleted: number;
  /** 1サイクル以上到達したか（count >= cycleSize）。vip.ts の isVIP 相当。 */
  reached: boolean;
};

/**
 * 累計来店回数からサロン単位の循環型進捗を求める純粋関数。
 * @param count     その顧客がそのサロンで貯めた累計来店回数
 * @param cycleSize サイクル幅（salons.visit_cycle_size）。
 */
export function computeVisitProgress(
  count: number,
  cycleSize: number,
): VisitProgress {
  // 負値・小数・不正なサイクル幅の混入に備えてガード（純粋関数として頑健に）。
  const size = Math.max(1, Math.floor(cycleSize));
  const n = Math.max(0, Math.floor(count));
  const progressInCycle = n % size;
  return {
    count: n,
    cycleSize: size,
    progressInCycle,
    toNextPerk: size - progressInCycle,
    cyclesCompleted: Math.floor(n / size),
    reached: n >= size,
  };
}
