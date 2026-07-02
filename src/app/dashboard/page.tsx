"use client";

import { useState } from "react";
import { Card, Eyebrow, VipBadge } from "@/components/ui";
import SalonNav from "@/components/SalonNav";
import { CYCLE_SIZE, computeVipProgress } from "@/lib/vip";
import StaffPeriodView from "./StaffPeriodView";
import HrFlowView from "./HrFlowView";
import {
  aggregate,
  resolveRange,
  salonRevenue,
  totalCount,
  trendDir,
  yen,
  type PresetKey,
  type Range,
} from "./eval-data";

/**
 * 評価ダッシュボード（デモ用モック・画面マップ14系の簡易版・白世界）。
 *
 * ★MVPデモ用。データは全てダミー（このファイルの const ＋ eval-data.ts）。
 *   DBクエリ / supabaseAdmin / 認証(getSession)は一切入れていない。
 *   本実装時は const 群と eval-data.ts の EVENTS を「service role の実クエリ＋認証」に差し替える前提。
 *   期間フィルタの state を所有し、上部「店舗合計¥」と下部「スタッフ別評価」で共有する
 *   （同じ期間に連動させるため client component）。
 *
 * 配色（§12）: 暖色モノクロ＋ゴールド（VIP）。ミントはサロンUI専用のポイント使い＝
 *   前期間比の上昇（.trend-up）とアクティブな期間プリセット（.filter-bar .chip.is-active）のみ。
 *   ¥は色を付けず中立の明朝。赤は使わない（減少も褪せグレー）。
 *
 * 規制ガード（厳守・原則5・6 / 金融庁回答の前提）:
 *  - ¥は「店舗合計（サロンの売上）」としてのみ表示する。スタッフ個人には¥を割り付けない
 *    （CLAUDE.md §2/§11 の「スタッフ単位に¥を出さない」ガードは維持・上書きしない）。
 *  - スタッフ個人は評価件数・ティア内訳・リアルボイス・前期間比のみ（§12）。
 *    個人別の¥・順位ポイント・加重スコアは出さない（StaffPeriodView 側）。
 *  - 賞与の自動算出は行わない。これは判断材料の可視化であって賞与計算ツールではない。
 *  - 原則7: 顧客個人（名前/ID）は通常は表示しない。
 *    ★VIP一覧でのみ顧客名を出すのは「レジでの判別補助」という現場要件のため意図的。
 *      本番ではこのセクションは店長権限の認証スコープ必須（mock のため省略）。
 */

// ---- ダミーデータ（本実装時にここだけ差し替える） --------------------
const SALON_NAME = "【DEMO】echo デモサロン";

const TIER_BREAKDOWN = [
  { label: "Thank you", count: 8 },
  { label: "Grateful", count: 9 },
  { label: "Wonderful", count: 4 },
  { label: "Amazing", count: 2 },
  { label: "Unforgettable", count: 1 },
];

// VIP のお客様（mock）。stampCount＝そのサロンで貯めた無料感想スタンプ総数。
// 進捗・特典付与回数は computeVipProgress(stampCount) から算出（直書きしない）。
const VIP_CUSTOMERS = [
  { name: "Saki", stampCount: 12, voice: "毎回ていねいで、来るたびに元気をもらってます" },
  { name: "けんた", stampCount: 9, voice: "担当さんの提案がいつも好み。通い続けたいです" },
  { name: "みゆき", stampCount: 7, voice: "仕上がりが理想どおりで、友達にも自慢しちゃいました" },
  { name: "Ryo.K", stampCount: 6, voice: "居心地がよくて、つい長居しちゃいます" },
  { name: "あや", stampCount: 5, voice: "細かい要望も笑顔で対応してくれて安心できます" },
  { name: "Tomo", stampCount: 4, voice: "ここに来ると気分が上がる。特別な場所です" },
];

// 最近の評価（顧客名は持たない・原則7）
const RECENT = [
  { time: "17:35", staff: "あゆむ", tier: "Wonderful" },
  { time: "16:20", staff: "あかり", tier: "Grateful" },
  { time: "15:02", staff: "あみ", tier: "Thank you" },
  { time: "13:48", staff: "原", tier: "Amazing" },
  { time: "11:15", staff: "拓馬", tier: "Thank you" },
];
// --------------------------------------------------------------------

// 前期間比（0除算ガード。符号付き整数%）。
function pct(prev: number, cur: number): string {
  if (prev <= 0) return "—";
  const d = Math.round(((cur - prev) / prev) * 100);
  return (d >= 0 ? "+" : "") + d + "%";
}

// 前期間比%（§12 ステータス配色）。上昇＝ミント（.trend-up）／横ばい・下降＝既定グレーのまま。
function DeltaPct({ prev, cur }: { prev: number; cur: number }) {
  const up = trendDir(prev, cur) === "up";
  return <span className={up ? "trend-up" : undefined}>{pct(prev, cur)}</span>;
}

export default function DashboardPage() {
  // ビュー切替: 日次（今の状態）/ HR月次（echo flow トレンド）。§12 の2タブ構成。
  const [view, setView] = useState<"daily" | "hr">("daily");
  // 期間フィルタの state（上部「店舗合計¥」と下部「スタッフ別」で共有）。
  const [mode, setMode] = useState<PresetKey | "custom">("thisMonth");
  const [custom, setCustom] = useState<Range>({
    start: "2026-04-01",
    end: "2026-11-20",
  });

  const { range, prevRange, label } = resolveRange(mode, custom);

  // 期間集計は1回だけ行い、評価件数・店舗合計¥で共有する（単一ソース・スタッフ別ビューと同じ EVENTS）。
  const curAgg = aggregate(range);
  const prevAgg = aggregate(prevRange);

  // 評価件数（感想＋評価スタンプ・期間連動）。今月選択時はスタッフ別ビューの各行合計と一致する。
  const evalCount = totalCount(curAgg);
  const evalCountPrev = totalCount(prevAgg);

  // 店舗合計の評価スタンプ売上（¥・期間連動）。全スタッフ分のティア正規価格の合計。
  // ★店舗の売上であって個人のチップではない（原則5）。
  const salonRev = salonRevenue(curAgg);
  const salonRevPrev = salonRevenue(prevAgg);

  // VIP顧客数（累計・期間フィルタ非連動）。現在VIPであるお客様の総数。
  // ★期間集計とは独立した「今の状態」（VIPは累計のスタンプ数で決まるため・原則とは別軸）。
  const vipTotal = VIP_CUSTOMERS.filter(
    (c) => computeVipProgress(c.stampCount).isVIP,
  ).length;

  // 日付ピッカー編集はカスタムモードへ。range は現在の解決済み期間。
  const handleStart = (v: string) => {
    setCustom({ start: v, end: range.end });
    setMode("custom");
  };
  const handleEnd = (v: string) => {
    setCustom({ start: range.start, end: v });
    setMode("custom");
  };

  return (
    <main className="page page-top">
      <div className="container container-wide stack animate-in">
        <SalonNav />
        {/* 1. ヘッダー */}
        <header className="dash-head">
          <div className="stack-sm">
            <Eyebrow>Salon dashboard</Eyebrow>
            <h1 className="headline">{SALON_NAME} ・ 評価ダッシュボード</h1>
          </div>
          <div className="stack-sm center-text">
            <span className="sample-badge">サンプルデータ</span>
            <p className="muted">対象期間：{label}</p>
          </div>
        </header>

        {/* ビュー切替タブ（日次 / HR月次）。アクティブ＝ミント（§12 アクティブタブ） */}
        <div className="seg" role="tablist" aria-label="ダッシュボードの表示切替">
          <button
            type="button"
            role="tab"
            aria-selected={view === "daily"}
            className={`seg-btn${view === "daily" ? " is-active" : ""}`}
            onClick={() => setView("daily")}
          >
            日次
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "hr"}
            className={`seg-btn${view === "hr" ? " is-active" : ""}`}
            onClick={() => setView("hr")}
          >
            HR（月次）
          </button>
        </div>

        {view === "hr" ? (
          /* HR月次ビュー（echo flow トレンド）。店舗合計¥は既存の値を再利用 */
          <HrFlowView salonRev={salonRev} label={label} />
        ) : (
          <>
            {/* 2. 先行指標。評価件数・店舗合計¥は期間フィルタに連動。VIPは累計（期間非連動）。 */}
            <div className="metric-grid">
          <div className="metric-card">
            <p className="metric-label">評価件数（対象期間）</p>
            <p className="metric-value">{evalCount}件</p>
            <p className="metric-delta">
              対象期間 {label}・前期間比{" "}
              <DeltaPct prev={evalCountPrev} cur={evalCount} />
            </p>
          </div>
          <div className="metric-card">
            <p className="metric-label">VIP顧客数（累計）</p>
            <p className="metric-value">{vipTotal}人</p>
            <p className="metric-delta">
              現在VIPのお客様の総数・期間フィルタとは独立
            </p>
          </div>
          <div className="metric-card">
            <p className="metric-label">評価スタンプ売上（店舗合計）</p>
            <p className="metric-value font-elegant">{yen(salonRev)}</p>
            <p className="metric-delta">
              対象期間 {label}・前期間比{" "}
              <DeltaPct prev={salonRevPrev} cur={salonRev} />
            </p>
          </div>
        </div>

        {/* 3. VIP のお客様（Phase 5-a・現場判別補助。本番は店長権限の認証必須） */}
        <Card>
          <div className="stack-md">
            <h2 className="headline-sm">VIP のお客様</h2>
            <div>
              {VIP_CUSTOMERS.map((c) => {
                // 進捗・特典付与回数は VIP ロジックに集約（直書きしない）。
                const vip = computeVipProgress(c.stampCount);
                return (
                  <div key={c.name} className="vip-row">
                    <div className="vip-row-head">
                      <span className="vip-name">{c.name}</span>
                      {vip.isVIP && <VipBadge />}
                      <span className="vip-progress">
                        {vip.progressInCycle} / {CYCLE_SIZE} ・ 特典付与{" "}
                        {vip.cyclesCompleted} 回
                      </span>
                    </div>
                    <p className="vip-voice">「{c.voice}」</p>
                  </div>
                );
              })}
            </div>
            <p className="note-fine">
              ※顧客名はレジでの判別補助のためこの画面でのみ表示します（原則7）。
              本番では店長権限の認証スコープを必須とします。
            </p>
          </div>
        </Card>

        {/* 4. ティア別の内訳 */}
        <Card>
          <div className="stack-md">
            <h2 className="headline-sm">ティア別の内訳</h2>
            <div className="pill-row">
              {TIER_BREAKDOWN.map((t) => (
                <span key={t.label} className="stat-pill">
                  <span className="stat-pill-label">{t.label}</span>
                  <span className="stat-pill-count">{t.count}</span>
                </span>
              ))}
            </div>
          </div>
        </Card>

        {/* 5. スタッフ別の評価（期間フィルタ付き・評価件数/ティア内訳/リアルボイス/前期間比のみ・¥は出さない） */}
        <Card>
          <StaffPeriodView
            mode={mode}
            custom={custom}
            onSelectPreset={(key) => setMode(key)}
            onChangeStart={handleStart}
            onChangeEnd={handleEnd}
          />
        </Card>

        {/* 6. 最近の評価 */}
        <Card>
          <div className="stack-md">
            <h2 className="headline-sm">最近の評価</h2>
            <div>
              {RECENT.map((r, i) => (
                <div key={i} className="recent-row">
                  <span className="recent-time">{r.time}</span>
                  <span className="recent-name">{r.staff}</span>
                  <span className="recent-tier">{r.tier}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
          </>
        )}
      </div>
    </main>
  );
}
