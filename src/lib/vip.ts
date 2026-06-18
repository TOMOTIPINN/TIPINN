/**
 * 無料感想スタンプの「循環型」進捗ロジック（CLAUDE.md §4 貯まるスタンプ / §11）。
 *
 * サロンごと（顧客 × サロン単位）に貯めた無料感想スタンプ総数 stampCount から、
 * VIP判定・サイクル内進捗・次の特典までの残数を導出する純粋関数。
 * 表示側（/mypage・/review/complete・将来のVIPバッジ／ダッシュボード）で再利用する。
 *
 * 仕様:
 * - 1サイクル = 感想スタンプ CYCLE_SIZE 個（= VIP特典の発動単位）。
 * - CYCLE_SIZE 個たまるたびに特典が発動し、サイクル内カウントは 0 に戻って再カウント。
 * - VIPは一度到達したら以降ずっと true（stampCount は減らないため自然に保たれる）。
 *   ＝ DB の earned_stamps.count はリセットしない。「0に戻る」のは表示上のサイクルだけ。
 *
 * ⚠️ 有料の評価スタンプ（Thank you〜Unforgettable の5段階）はこのロジックの対象外。
 */

/** サイクル幅（= 特典発動に必要な感想スタンプ数）。
 *  後で実データを見て調整するため、マジックナンバーを直書きせずここで一元管理する。 */
export const CYCLE_SIZE = 3;

export type VipProgress = {
  /** 貯めた無料感想スタンプ総数（顧客 × サロン）。リセットされない累積値。 */
  stampCount: number;
  /** CYCLE_SIZE 個以上で true。一度立つと以降ずっと true（点灯したまま）。 */
  isVIP: boolean;
  /** 特典付与回数 = floor(stampCount / CYCLE_SIZE)。 */
  cyclesCompleted: number;
  /** 現サイクルの進捗 0〜CYCLE_SIZE-1。 */
  progressInCycle: number;
  /** 次の特典まであと何個（1〜CYCLE_SIZE）。 */
  toNextPerk: number;
};

/**
 * stampCount からサロン単位の循環型進捗を求める純粋関数。
 * @param stampCount その顧客がそのサロンで貯めた無料感想スタンプ総数
 * @param cycleSize  サイクル幅（既定 CYCLE_SIZE）。実データ調整用に上書き可。
 */
export function computeVipProgress(
  stampCount: number,
  cycleSize: number = CYCLE_SIZE,
): VipProgress {
  // 負値・小数・不正なサイクル幅の混入に備えてガード（純粋関数として頑健に）。
  const size = Math.max(1, Math.floor(cycleSize));
  const count = Math.max(0, Math.floor(stampCount));
  const progressInCycle = count % size;
  return {
    stampCount: count,
    isVIP: count >= size,
    cyclesCompleted: Math.floor(count / size),
    progressInCycle,
    toNextPerk: size - progressInCycle,
  };
}
