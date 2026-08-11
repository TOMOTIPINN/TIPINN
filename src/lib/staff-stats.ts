/**
 * スタッフ向け画面（Phase 5-b・画面12/13）の集計ヘルパー（単一ソース）。
 *
 * 原則（docs/archive/phase5b_staff_screens.md §2 / docs/30_design.md）:
 *  - echo flow はカウント単位のみ。**¥金額をここに持ち込まない**（賞与非連動・原則6）。
 *  - 集計の軸は staff_id（将来のポータブル評価グラフのフック・§8）。
 *  - 期間境界は JST（Asia/Tokyo）で切る。スタンプ付与の「1日1個」と同じ基準。
 *
 * ここは純粋関数のみ（DB非依存）。実クエリは各画面が supabaseAdmin で行い、
 * 件数 → ランク/期間ラベルの導出だけをこの lib に集約する。
 */

/** JST は UTC+9 固定（サマータイム無し）。 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * いまの UTC ミリ秒から、JST のある境界に丸めた「UTC の瞬間」を ISO 文字列で返す。
 * supabase の `gte("created_at", iso)` にそのまま渡せる（created_at は timestamptz）。
 *
 * @param kind  today=今日0時 / week=今週月曜0時 / month=今月1日0時 / quarter=四半期初日0時（すべてJST）
 * @param nowMs 基準時刻（既定 Date.now()）。テスト容易性のため引数化。
 */
export function jstPeriodStartISO(
  kind: "today" | "week" | "month" | "quarter",
  nowMs: number = Date.now(),
): string {
  // JST の壁時計を UTC のフィールドとして扱うため +9h シフトしてから丸める。
  const d = new Date(nowMs + JST_OFFSET_MS);
  d.setUTCHours(0, 0, 0, 0);

  if (kind === "week") {
    // 週は月曜始まり。getUTCDay: 0=日…6=土 → 月曜からの経過日数。
    const fromMonday = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - fromMonday);
  } else if (kind === "month") {
    d.setUTCDate(1);
  } else if (kind === "quarter") {
    const qStartMonth = d.getUTCMonth() - (d.getUTCMonth() % 3);
    d.setUTCMonth(qStartMonth, 1);
  }

  // 丸めた JST 壁時計を本来の UTC 瞬間へ戻す。
  return new Date(d.getTime() - JST_OFFSET_MS).toISOString();
}

/**
 * 時刻帯あいさつ（JST）。スタッフホームのヘッダー用。
 *  〜10:59=morning / 〜17:59=afternoon / それ以降=evening
 */
export function jstGreeting(nowMs: number = Date.now()): "morning" | "afternoon" | "evening" {
  const hour = new Date(nowMs + JST_OFFSET_MS).getUTCHours();
  if (hour < 11) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export const GREETING_LABEL: Record<ReturnType<typeof jstGreeting>, string> = {
  morning: "Good morning",
  afternoon: "Good afternoon",
  evening: "Good evening",
};

/**
 * 有償「評価スタンプ」件数の表示スイッチ（唯一の正・§8）。
 * true＝評価スタンプの件数（¥ではない）を集計・表示する。
 * ランク表示は別スイッチ RANK_ENABLED で制御する（件数は出すがランクは伏せる、が可能）。
 */
export const PAID_STAMPS_ENABLED: boolean = true;

/**
 * ランク（A/B/C/D）表示のスイッチ（唯一の正・§8）。
 * 現状は仮閾値で誤解を招くため false＝ランクは伏せる（PAID_STAMPS_ENABLED とは独立）。
 */
export const RANK_ENABLED: boolean = false;

/**
 * 受け取った評価件数 → ランク（A/B/C/D）。
 * ⚠️ 閾値は **仮置き**（後で実データを見て調整 / サロン規模で正規化する想定）。
 *   絶対件数のため、若手＝低件数を構造的に不利にしないよう「育成の目安」に留める（§2・§12）。
 *   ¥でも順位スコアでもない（echo flow＝カウント指標）。
 */
export function rankForCount(total: number): "A" | "B" | "C" | "D" {
  if (total >= 100) return "A";
  if (total >= 50) return "B";
  if (total >= 20) return "C";
  return "D";
}

/** 符号付きの差分表記（先週比など）。0以上は + を付ける。 */
export function signed(delta: number): string {
  return (delta >= 0 ? "+" : "") + delta;
}
