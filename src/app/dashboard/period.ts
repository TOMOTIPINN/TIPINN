/**
 * ダッシュボードの集計期間の解決（server専用・純関数・DB非依存）。
 *
 * URL の searchParams（period / from / to）から、getDashboardData に渡す
 *   { periodStart, periodEnd（ISO・timestamptz 比較用）, label } を一意に決める。
 *   同じ URL は必ず同じ periodStart/periodEnd を返す（custom は暦区間で確定＝賞与査定の再現性）。
 *
 * 期間の種類（原則8的な「唯一の正」＝ここだけで決める）:
 *  - month       今月（JST 月初 0:00 〜 現在）        ※相対（開くたび当月）
 *  - last-month  先月（JST 先月初 0:00 〜 今月初 0:00）※相対
 *  - 3m/6m/12m   直近3/6/12ヶ月（JST・当日0:00から N ヶ月遡る 〜 現在）※相対
 *  - custom      開始月1日 0:00 〜 終了月末日 23:59:59（＝翌月1日 0:00 の直前）。
 *                終了月が未来/当月なら現在時刻まで。暦区間で確定＝再現性あり。
 *
 * 不正・欠落は「今月」にフォールバックする（key も month に倒す）。
 *
 * 日付基準（JST / Asia/Tokyo・UTC+9 固定）は dashboard-data.ts / staff-stats.ts と同一。
 *   inWindow は [start, end)（end 排他）で比較されるため、上限は「翌月1日 0:00」を渡す。
 */

/** JST は UTC+9 固定（サマータイム無し）。 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type PeriodKey = "month" | "last-month" | "3m" | "6m" | "12m" | "custom";

export type ResolvedPeriod = {
  key: PeriodKey;
  /** custom のときのみ（UI のプリフィル用）。YYYY-MM。 */
  from?: string;
  to?: string;
  periodStart: string; // UTC-ISO（gte 比較用）
  periodEnd: string; // UTC-ISO（lt 比較用・end 排他）
  label: string;
};

/** UI が並べるプリセット（順序＝表示順）。custom はここに含めない（別枠）。 */
export const PERIOD_PRESETS: { key: Exclude<PeriodKey, "custom">; label: string }[] = [
  { key: "month", label: "今月" },
  { key: "last-month", label: "先月" },
  { key: "3m", label: "直近3ヶ月" },
  { key: "6m", label: "直近6ヶ月" },
  { key: "12m", label: "直近1年" },
];

// JST の壁時計を UTC フィールドとして扱い（+9h シフト）、丸めてから本来の UTC 瞬間へ戻す。
// dashboard-data.ts の jstMonthStartMs と同じ流儀。
function jstMonthStartMs(nowMs: number, monthsBack: number): number {
  const d = new Date(nowMs + JST_OFFSET_MS);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - monthsBack);
  return d.getTime() - JST_OFFSET_MS;
}

// 当日 JST 0:00 から monthsBack ヶ月前（day-aligned・「直近Nヶ月」用）。
// ※月末日（31日）→短い月は翌月へ繰り上がる JS 標準挙動あり（プリセットの端数として許容）。
function jstDayStartMonthsBackMs(nowMs: number, monthsBack: number): number {
  const d = new Date(nowMs + JST_OFFSET_MS);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCMonth(d.getUTCMonth() - monthsBack);
  return d.getTime() - JST_OFFSET_MS;
}

// 指定の年月（1..12）の JST 月初 0:00 を UTC ミリ秒で返す。
function jstMonthStartFromYMMs(year: number, month1to12: number): number {
  return Date.UTC(year, month1to12 - 1, 1, 0, 0, 0, 0) - JST_OFFSET_MS;
}

// 指定の年月の「翌月1日 0:00（JST）」＝ end 排他の上限。
function jstMonthEndExclusiveFromYMMs(year: number, month1to12: number): number {
  const ny = month1to12 === 12 ? year + 1 : year;
  const nm = month1to12 === 12 ? 1 : month1to12 + 1;
  return jstMonthStartFromYMMs(ny, nm);
}

const iso = (ms: number) => new Date(ms).toISOString();

// "YYYY-MM" → { year, month }（month は 1..12）。妥当でなければ null。
function parseYearMonth(v: string | undefined): { year: number; month: number } | null {
  if (!v || !/^\d{4}-\d{2}$/.test(v)) return null;
  const year = Number(v.slice(0, 4));
  const month = Number(v.slice(5, 7));
  // 常識的な範囲だけ許す（暴走入力の弾き）。
  if (year < 2020 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/** 今月（フォールバック含む単一ソース）。 */
function monthPeriod(nowMs: number): ResolvedPeriod {
  return {
    key: "month",
    periodStart: iso(jstMonthStartMs(nowMs, 0)),
    periodEnd: iso(nowMs),
    label: "今月",
  };
}

/**
 * searchParams から集計期間を解決する。
 * @param params { period, from, to }（すべて optional・生の文字列）
 * @param nowMs  基準時刻（既定 Date.now()）。テスト容易性のため引数化。
 */
export function resolvePeriod(
  params: { period?: string; from?: string; to?: string },
  nowMs: number = Date.now(),
): ResolvedPeriod {
  const period = params.period;

  switch (period) {
    case undefined:
    case "":
    case "month":
      return monthPeriod(nowMs);

    case "last-month":
      return {
        key: "last-month",
        periodStart: iso(jstMonthStartMs(nowMs, 1)),
        periodEnd: iso(jstMonthStartMs(nowMs, 0)),
        label: "先月",
      };

    case "3m":
      return {
        key: "3m",
        periodStart: iso(jstDayStartMonthsBackMs(nowMs, 3)),
        periodEnd: iso(nowMs),
        label: "直近3ヶ月",
      };

    case "6m":
      return {
        key: "6m",
        periodStart: iso(jstDayStartMonthsBackMs(nowMs, 6)),
        periodEnd: iso(nowMs),
        label: "直近6ヶ月",
      };

    case "12m":
      return {
        key: "12m",
        periodStart: iso(jstDayStartMonthsBackMs(nowMs, 12)),
        periodEnd: iso(nowMs),
        label: "直近1年",
      };

    case "custom": {
      const f = parseYearMonth(params.from);
      const t = parseYearMonth(params.to);
      // 欠落・不正・逆順（from > to）は今月へフォールバック。
      if (!f || !t) return monthPeriod(nowMs);
      const fRank = f.year * 12 + f.month;
      const tRank = t.year * 12 + t.month;
      if (fRank > tRank) return monthPeriod(nowMs);

      const startMs = jstMonthStartFromYMMs(f.year, f.month);
      // 終了月末日 23:59:59（＝翌月1日 0:00 排他）。未来/当月なら現在まで。
      const endMs = Math.min(jstMonthEndExclusiveFromYMMs(t.year, t.month), nowMs);
      const fromStr = `${f.year}-${String(f.month).padStart(2, "0")}`;
      const toStr = `${t.year}-${String(t.month).padStart(2, "0")}`;
      const label =
        fRank === tRank
          ? `${f.year}年${f.month}月`
          : `${f.year}年${f.month}月〜${t.year}年${t.month}月`;
      return { key: "custom", from: fromStr, to: toStr, periodStart: iso(startMs), periodEnd: iso(endMs), label };
    }

    default:
      // 未知の period 値は今月へ。
      return monthPeriod(nowMs);
  }
}
