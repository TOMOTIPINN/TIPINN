"use client";

import { useState } from "react";
import {
  TIER_ORDER,
  TIER_EMOJI,
  trendText,
  trendDir,
  type StaffAgg,
} from "./eval-data";

/**
 * スタッフ別の評価ビュー（画面マップ14系）。集計は server（dashboard-data.ts）が行い、
 * cur / prev（期間・前期間の StaffAgg マップ）を props で受け取る。
 *
 * 表示内容（§12）: 評価件数 / ティア内訳（絵文字＋件数） / リアルボイス / 前期間比 のみ。
 *
 * 法的ガード（厳守・原則5・6 / 金融庁回答の前提）:
 *  - スタッフ個人に ¥売上・賞与額・順位ポイント・加重スコアは出さない（StaffAgg.revenue は集計層で 0）。
 *  - ¥は「店舗合計」としてのみ上部の先行指標に表示する（このビューには出さない）。
 *  - 前期間比は §12 のステータス配色：上昇＝ミント／横ばい・下降＝グレー（赤は使わない）。
 *
 * ※ 期間セレクタは今回「今月」固定のため非表示。対象スタッフ選択（下記）は props 上の純client フィルタ。
 */
export default function StaffPeriodView({
  staffNames,
  staffRole,
  staffArchived,
  cur,
  prev,
  label,
}: {
  staffNames: string[];
  staffRole: Record<string, string>;
  staffArchived: Record<string, boolean>;
  cur: Record<string, StaffAgg>;
  prev: Record<string, StaffAgg>;
  label: string;
}) {
  // 対象スタッフ選択（親と共有不要なのでローカル state）。"all"＝全員。
  const [selectedStaff, setSelectedStaff] = useState<string>("all");
  const isAll = selectedStaff === "all";
  const staffToShow = isAll ? staffNames : staffNames.filter((n) => n === selectedStaff);

  const hasAny = staffNames.some(
    (n) => (cur[n]?.reviews ?? 0) + (cur[n]?.ratings ?? 0) > 0,
  );

  return (
    <div className="stack-md">
      <h2 className="headline-sm">スタッフ別の評価</h2>

      <p className="period-current">対象期間：{label}</p>

      {/* 対象スタッフ選択（chip/is-active/filter-bar を流用）。
          「全員」＝現行表示 / 個人＝そのスタッフのみ・0件でも表示。 */}
      <div className="filter-bar" role="group" aria-label="対象スタッフ">
        <button
          type="button"
          aria-pressed={isAll}
          className={`chip${isAll ? " is-active" : ""}`}
          onClick={() => setSelectedStaff("all")}
        >
          全員
        </button>
        {staffNames.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={selectedStaff === name}
            className={`chip${selectedStaff === name ? " is-active" : ""}`}
            onClick={() => setSelectedStaff(name)}
          >
            {name}
          </button>
        ))}
      </div>

      {/* スタッフ別の集計（§12）：評価件数 / ティア内訳 / リアルボイス / 前期間比 のみ。
          個人別の¥・順位ポイント・加重スコアは出さない（店舗合計¥のみ上部）。 */}
      {isAll && !hasAny ? (
        <p className="muted">この期間の評価データはありません。</p>
      ) : (
        <div>
          {staffToShow.map((name) => {
            const a = cur[name];
            const p = prev[name];
            if (!a) return null;
            const curTotal = a.reviews + a.ratings;
            // 「活動が無いスタッフは省略」は全員表示のときのみ。個人選択時は0件でも表示。
            if (isAll && curTotal === 0) return null;
            const prevTotal = (p?.reviews ?? 0) + (p?.ratings ?? 0);
            // 前期間比の方向で色を分ける（§12: 上昇＝ミント / 横ばい・下降＝グレー）。
            const up = trendDir(prevTotal, curTotal) === "up";
            // 個人選択時はティア全種を0件込みで表示（0件は is-zero で減光＝「無い」ことも査定情報）。
            // 全員表示時は現行どおり件数>0のティアのみ。
            const tierList = isAll
              ? TIER_ORDER.filter((t) => a.tiers[t] > 0)
              : TIER_ORDER;
            const showPillRow = isAll ? a.ratings > 0 : true;
            const archived = staffArchived[name];
            return (
              <div
                key={name}
                className={`staff-period${archived ? " is-archived" : ""}`}
              >
                <div className="staff-period-head">
                  <span className="staff-period-name">{name}</span>
                  <span className="role-tag">{staffRole[name]}</span>
                  {archived && <span className="archived-tag">退職</span>}
                  <span className={`staff-period-trend${up ? " trend-up" : ""}`}>
                    {trendText(prevTotal, curTotal)}
                  </span>
                </div>

                <p className="staff-period-counts">
                  感想 {a.reviews}件 ・ 評価スタンプ {a.ratings}件
                </p>

                {showPillRow && (
                  <div className="pill-row">
                    {tierList.map((t) => (
                      // 内部向け：絵文字＋件数（例「🎉 1」）。ティア名は aria-label/title に残す。
                      <span
                        key={t}
                        className={`stat-pill${a.tiers[t] === 0 ? " is-zero" : ""}`}
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
      )}

      <p className="note-fine">
        ※スタッフ別は評価の件数・内訳などの非金銭の指標です。¥は店舗合計として
        上部にのみ表示します。賞与・報酬は各店舗オーナーの裁量判断で、echo は購入代金と
        機械的に連動した自動算出を行いません（原則5・6 / 金融庁回答の前提）。
      </p>
    </div>
  );
}
