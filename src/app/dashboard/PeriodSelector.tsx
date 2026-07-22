"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PERIOD_PRESETS, type PeriodKey } from "./period";
import MonthPicker from "./MonthPicker";

// JST（UTC+9）の現在の年月 "YYYY-MM"。終了月の上限＝当月（未来月を選ばせない）に使う。
function jstNowYM(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * 集計期間の選択 UI（サロンダッシュボード・§12 サロンUI＝アクティブ＝ミント）。
 *
 * 状態は URL に持つ（server が resolvePeriod で再解決＝単一ソース）。押下＝URL遷移で
 *   server component が再フェッチする。client は集計しない（supabaseAdmin は server 専用）。
 *   ブックマーク・共有した URL は同じ期間を再現する（原則：同じ URL＝同じ結果）。
 *
 * - プリセット5つ（今月/先月/直近3/6/12ヶ月）＝相対期間。
 * - カスタム＝開始月・終了月（<input type="month">・月単位）。賞与査定などの確定暦区間用。
 *
 * スタイルは既存の共有クラス（.filter-bar / .chip / .date-range / .field）を流用（インラインstyle禁止・§8）。
 * active 表示は .filter-bar .chip.is-active（ミントの淡い面）。
 */
export default function PeriodSelector({
  periodKey,
  from,
  to,
}: {
  periodKey: PeriodKey;
  from?: string;
  to?: string;
}) {
  const router = useRouter();
  // カスタム月入力（"YYYY-MM"）。custom で開いていれば URL 由来の値をプリフィル。
  const [fromMonth, setFromMonth] = useState<string>(from ?? "");
  const [toMonth, setToMonth] = useState<string>(to ?? "");
  // 当月（JST）＝終了月の上限。lazy 初期化（DOM に出るのは閉じたトリガーのみ＝currentYM は
  // 初期描画のマークアップに影響しない＝ハイドレーション不一致は起きない。client 側は正しい JST 値になる）。
  const [currentYM] = useState<string>(jstNowYM);

  function goPreset(key: Exclude<PeriodKey, "custom">) {
    router.push(`/dashboard?period=${key}`);
  }

  function applyCustom() {
    if (!fromMonth || !toMonth) return;
    const params = new URLSearchParams({ period: "custom", from: fromMonth, to: toMonth });
    router.push(`/dashboard?${params.toString()}`);
  }

  return (
    <div className="stack-sm">
      {/* プリセット（相対期間） */}
      <div className="filter-bar" role="group" aria-label="集計期間">
        {PERIOD_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={periodKey === p.key}
            className={`chip${periodKey === p.key ? " is-active" : ""}`}
            onClick={() => goPreset(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* カスタム暦区間（賞与査定など・月単位で確定）。自前の月ピッカー（MonthPicker）。 */}
      <div className="date-range" role="group" aria-label="カスタム期間">
        <span className="field-label">カスタム期間</span>
        <MonthPicker
          value={fromMonth}
          onChange={setFromMonth}
          max={toMonth || currentYM || undefined}
          ariaLabel="開始月"
          placeholder="開始月"
        />
        <span className="date-sep" aria-hidden="true">
          〜
        </span>
        <MonthPicker
          value={toMonth}
          onChange={setToMonth}
          min={fromMonth || undefined}
          max={currentYM || undefined}
          ariaLabel="終了月"
          placeholder="終了月"
        />
        <button
          type="button"
          aria-pressed={periodKey === "custom"}
          className={`chip${periodKey === "custom" ? " is-active" : ""}`}
          onClick={applyCustom}
          disabled={!fromMonth || !toMonth}
        >
          適用
        </button>
      </div>
    </div>
  );
}
