"use client";

import { useMemo } from "react";
import {
  STAFF,
  STAFF_ROLE,
  TIER_ORDER,
  TIER_EMOJI,
  PRESETS,
  aggregate,
  trendText,
  trendDir,
  resolveRange,
  type Range,
  type PresetKey,
} from "./eval-data";

/**
 * スタッフ別の評価ビュー（デモmock・画面マップ14系）。期間フィルタは親（page.tsx）が所有し、
 * 同じ state を「店舗合計¥（上部先行指標）」と共有する（controlled component）。
 *
 * 表示内容（§12）: 評価件数 / ティア内訳（絵文字＋件数） / リアルボイス / 前期間比 のみ。
 *
 * 法的ガード（厳守・原則5・6 / 金融庁回答の前提）:
 *  - スタッフ個人に ¥売上・賞与額・順位ポイント・加重スコアは出さない（§12 / §2・§11 のガード維持）。
 *  - ¥は「店舗合計」としてのみ上部の先行指標に表示する（このビューには出さない）。
 *  - 前期間比は §12 のステータス配色：上昇＝ミント／横ばい・下降＝グレー（赤は使わない）。
 *  - 賞与の自動算出は行わない。判断材料の可視化であって賞与計算ツールではない。
 */
export default function StaffPeriodView({
  mode,
  custom,
  onSelectPreset,
  onChangeStart,
  onChangeEnd,
}: {
  mode: PresetKey | "custom";
  custom: Range;
  onSelectPreset: (key: PresetKey) => void;
  onChangeStart: (value: string) => void;
  onChangeEnd: (value: string) => void;
}) {
  const { range, prevRange, label } = resolveRange(mode, custom);

  const cur = useMemo(() => aggregate(range), [range]);
  const prev = useMemo(() => aggregate(prevRange), [prevRange]);

  const hasAny = STAFF.some((n) => cur[n].reviews + cur[n].ratings > 0);

  return (
    <div className="stack-md">
      <h2 className="headline-sm">スタッフ別の評価</h2>

      {/* 期間フィルタ：プリセット chip ＋ カスタム日付範囲（state は親が所有・店舗合計¥と共有） */}
      <div className="stack-sm">
        <div className="filter-bar" role="group" aria-label="期間プリセット">
          {(Object.keys(PRESETS) as PresetKey[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={mode === key}
              className={`chip${mode === key ? " is-active" : ""}`}
              onClick={() => onSelectPreset(key)}
            >
              {PRESETS[key].label}
            </button>
          ))}
          <span
            className={`chip${mode === "custom" ? " is-active" : ""}`}
            aria-hidden="true"
          >
            カスタム
          </span>
        </div>

        <div className="date-range">
          <input
            type="date"
            className="field"
            aria-label="開始日"
            value={range.start}
            onChange={(e) => onChangeStart(e.target.value)}
          />
          <span className="date-sep" aria-hidden="true">
            〜
          </span>
          <input
            type="date"
            className="field"
            aria-label="終了日"
            value={range.end}
            onChange={(e) => onChangeEnd(e.target.value)}
          />
        </div>

        <p className="period-current">対象期間：{label}</p>
      </div>

      {/* スタッフ別の集計（§12）：評価件数 / ティア内訳 / リアルボイス / 前期間比 のみ。
          個人別の¥・順位ポイント・加重スコアは出さない（店舗合計¥のみ上部）。 */}
      {hasAny ? (
        <div>
          {STAFF.map((name) => {
            const a = cur[name];
            const p = prev[name];
            const curTotal = a.reviews + a.ratings;
            if (curTotal === 0) return null; // この期間に活動が無いスタッフは省略
            const prevTotal = p.reviews + p.ratings;
            // 前期間比の方向で色を分ける（§12: 上昇＝ミント / 横ばい・下降＝グレー）。
            const up = trendDir(prevTotal, curTotal) === "up";
            return (
              <div key={name} className="staff-period">
                <div className="staff-period-head">
                  <span className="staff-period-name">{name}</span>
                  <span className="role-tag">{STAFF_ROLE[name]}</span>
                  <span className={`staff-period-trend${up ? " trend-up" : ""}`}>
                    {trendText(prevTotal, curTotal)}
                  </span>
                </div>

                <p className="staff-period-counts">
                  感想 {a.reviews}件 ・ 評価スタンプ {a.ratings}件
                </p>

                {a.ratings > 0 && (
                  <div className="pill-row">
                    {TIER_ORDER.filter((t) => a.tiers[t] > 0).map((t) => (
                      // 内部向け：絵文字＋件数（例「🎉 1」）。ティア名は aria-label/title に残す。
                      <span
                        key={t}
                        className="stat-pill"
                        title={`${t}：${a.tiers[t]}件`}
                        aria-label={`${t} ${a.tiers[t]}件`}
                      >
                        <span className="stat-pill-emoji" aria-hidden="true">
                          {TIER_EMOJI[t]}
                        </span>
                        <span className="stat-pill-count">{a.tiers[t]}</span>
                      </span>
                    ))}
                  </div>
                )}

                {a.voice && <p className="vip-voice">「{a.voice}」</p>}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted">この期間の評価データはありません。</p>
      )}

      <p className="note-fine">
        ※スタッフ別は評価の件数・内訳などの非金銭の指標です。¥は店舗合計として
        上部にのみ表示します。賞与・報酬は各店舗オーナーの裁量判断で、echo は購入代金と
        機械的に連動した自動算出を行いません（原則5・6 / 金融庁回答の前提）。
      </p>
    </div>
  );
}
