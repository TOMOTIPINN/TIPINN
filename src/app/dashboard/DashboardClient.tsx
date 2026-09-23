"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, Eyebrow, VipBadge } from "@/components/ui";
import SalonNav from "@/components/SalonNav";
import type { SalonRole } from "@/components/RoleBar";
import { CYCLE_SIZE, computeVipProgress } from "@/lib/vip";
import StaffPeriodView from "./StaffPeriodView";
import HrFlowView from "./HrFlowView";
import PeriodSelector from "./PeriodSelector";
import { trendDir, yen } from "./eval-data";
import type { DashboardData } from "./dashboard-data";
import type { PeriodKey } from "./period";
import {
  RECENT_MAX_TAKE,
  RECENT_PAGE_SIZE,
  dashboardHref,
} from "./recent";

/**
 * 評価ダッシュボード（画面マップ14系・白世界）— 表示のみの client。
 *
 * データは server（page.tsx → dashboard-data.ts）が salon_id スコープで集計し props で注入する。
 *   集計期間は URL 由来（server が resolvePeriod で決定）。期間の選択は PeriodSelector（URL遷移で
 *   server 再フェッチ）。view(日次/HR)切替は client の局所 state。
 *
 * 配色（§12）: 暖色モノクロ＋ゴールド（VIP）。ミントはサロンUIのポイント使い＝前期間比の上昇
 *   （.trend-up）とアクティブタブのみ。¥は色を付けず中立の明朝。赤は使わない。
 *
 * 規制ガード（原則5・6・7）:
 *  - ¥は「店舗合計」としてのみ表示（個人に割り付けない・per-staff の ¥ は集計層で 0 化済）。
 *  - スタッフ個人は件数・ティア内訳・ボイス・前期間比のみ（StaffPeriodView）。
 *  - 顧客名は VIP 一覧（レジ判別補助）と最近の評価（§20 決定3）のみ。この画面は manager 専用（原則7）。
 */

// 前期間比（0除算ガード。符号付き整数%）。
function pct(prev: number, cur: number): string {
  if (prev <= 0) return "—";
  const d = Math.round(((cur - prev) / prev) * 100);
  return (d >= 0 ? "+" : "") + d + "%";
}

// 前期間比%（§12 ステータス配色）。上昇＝ミント（.trend-up）／横ばい・下降＝既定グレー。
function DeltaPct({ prev, cur }: { prev: number; cur: number }) {
  const up = trendDir(prev, cur) === "up";
  return <span className={up ? "trend-up" : undefined}>{pct(prev, cur)}</span>;
}

// Stripe 連携状態の表示（Phase 2）。決済可＝控えめな1行／未連携・審査中＝導線カード。
// 導線は /api/manager/stripe/onboard への native form POST（連結アカウント再利用→Account Link 生成→303）。
function StripeStatusCard({ status }: { status: StripeStatus | null }) {
  // null＝カードごと出さない。/owner は店舗の設定を行わない（§8.1）ので、
  // /api/manager/stripe/onboard への form POST を持つこのカードを描画しない（§21 コミット3b）。
  if (status === null) return null;
  if (status === "enabled") {
    return (
      <p className="note-fine">
        Stripe 連携済み（評価スタンプの決済を受け付けています）。
      </p>
    );
  }
  const isPending = status === "pending";
  return (
    <Card>
      <div className="stack-sm">
        <Eyebrow className="eyebrow-mint">Stripe connect</Eyebrow>
        <h2 className="headline-sm">
          {isPending ? "決済連携は審査中です" : "決済連携が未設定です"}
        </h2>
        <p className="muted text-balance">
          {isPending
            ? "Stripe の確認が完了すると、お客様の評価スタンプ決済を受け付けられます。未入力があれば続きから登録してください。"
            : "お客様が評価スタンプを購入するには、Stripe の連携（本人確認・入金設定）が必要です。"}
        </p>
        <form action="/api/manager/stripe/onboard" method="post">
          <button type="submit" className="btn btn-outline btn-block">
            {isPending ? "連携を続ける" : "Stripe連携をはじめる"}
          </button>
        </form>
      </div>
    </Card>
  );
}

// Stripe 連携状態（Phase 2）: none=未連携 / pending=審査中 / enabled=決済可。
export type StripeStatus = "none" | "pending" | "enabled";

export default function DashboardClient({
  data,
  role,
  period,
  recentTake,
  stripeStatus,
  basePath = "/dashboard",
  nav,
}: {
  data: DashboardData;
  role: SalonRole;
  period: { key: PeriodKey; from?: string; to?: string };
  /** 「最近の評価」の読み込み深さ（URL の ?take= 由来・§20 決定4）。 */
  recentTake: number;
  /** null なら Stripe 連携カードを出さない（/owner 用・§21 コミット3b）。 */
  stripeStatus: StripeStatus | null;
  /**
   * 期間切替・「もっと見る」の遷移先ベースパス。既定は `/dashboard`（従来どおり）。
   * `/owner/[salonId]/dashboard` はここを自分のパスにして、同じ画面を別サロンで使う。
   */
  basePath?: string;
  /**
   * 画面上部のナビ。既定（未指定）は従来どおり `<SalonNav />`。
   * `/owner` は `/manager/*`・`/staff/*` への導線を出さないため、自前のナビを渡す（§21 コミット3b）。
   */
  nav?: React.ReactNode;
}) {
  // ビュー切替: 日次（今の状態）/ HR月次（echo flow トレンド）。§12 の2タブ構成。
  const [view, setView] = useState<"daily" | "hr">("daily");

  const { label } = data;
  const salonRev = data.salonRevenueCur;
  const salonRevPrev = data.salonRevenuePrev;

  return (
    <main className="page page-top" data-role={role}>
      <div className="container container-wide stack animate-in">
        {nav ?? <SalonNav role={role} />}
        {/* 1. ヘッダー */}
        <header className="dash-head">
          <div className="stack-sm">
            <Eyebrow>Salon dashboard</Eyebrow>
            <h1 className="headline">{data.salonName} ・ 評価ダッシュボード</h1>
          </div>
          <div className="stack-sm center-text">
            <p className="muted">対象期間：{label}</p>
          </div>
        </header>

        {/* Stripe 連携状態（Phase 2）。未連携・審査中のときだけ導線を出す。決済可なら控えめな1行。 */}
        <StripeStatusCard status={stripeStatus} />

        {/* 集計期間の選択（プリセット＋カスタム暦区間）。URL遷移で server 再フェッチ。 */}
        <PeriodSelector
          periodKey={period.key}
          from={period.from}
          to={period.to}
          basePath={basePath}
        />

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
          <HrFlowView
            flows={data.flows}
            monthLabels={data.monthLabels}
            staffRole={data.staffRole}
          />
        ) : (
          <>
            {/* 2. 先行指標（4枚）。感想・評価スタンプ・店舗合計¥は期間連動。VIPは累計（期間非連動）。
                ★感想とスタンプを合算しない（§18 B・2026-09-17 修正）★
                  合算の前期間比では「どちらが増えたか」が読めない。前期間比も
                  それぞれの数字どうしで比べる（前期間の定義は変えない＝直前の同じ長さの窓）。
                並びは**期間連動の3枚を先に、期間非連動の VIP を最後**に置く。 */}
            <div className="metric-grid metric-grid-4">
              <div className="metric-card">
                <p className="metric-label">感想（対象期間）</p>
                <p className="metric-value">{data.reviewCountCur}件</p>
                <p className="metric-delta">
                  対象期間 {label}（{data.curRangeLabel}）・前期間比{" "}
                  <DeltaPct
                    prev={data.reviewCountPrev}
                    cur={data.reviewCountCur}
                  />
                  （前期間 {data.prevRangeLabel}）
                </p>
              </div>
              <div className="metric-card">
                <p className="metric-label">評価スタンプ（対象期間）</p>
                <p className="metric-value">{data.ratingCountCur}件</p>
                <p className="metric-delta">
                  対象期間 {label}（{data.curRangeLabel}）・前期間比{" "}
                  <DeltaPct
                    prev={data.ratingCountPrev}
                    cur={data.ratingCountCur}
                  />
                  （前期間 {data.prevRangeLabel}）
                </p>
              </div>
              <div className="metric-card">
                <p className="metric-label">評価スタンプ売上（店舗合計）</p>
                <p className="metric-value font-elegant">{yen(salonRev)}</p>
                <p className="metric-delta">
                  対象期間 {label}（{data.curRangeLabel}）・前期間比{" "}
                  <DeltaPct prev={salonRevPrev} cur={salonRev} />
                  （前期間 {data.prevRangeLabel}）
                </p>
              </div>
              <div className="metric-card">
                <p className="metric-label">VIP顧客数（累計）</p>
                <p className="metric-value">{data.vipTotal}人</p>
                <p className="metric-delta">
                  現在VIPのお客様の総数・期間フィルタとは独立
                </p>
              </div>
            </div>

            {/* 3. VIP のお客様（現場判別補助・原則7。顧客名はこの画面のみ） */}
            <Card>
              <div className="stack-md">
                <h2 className="headline-sm">VIP のお客様</h2>
                <div>
                  {data.vipCustomers.length === 0 ? (
                    <p className="muted">まだVIPのお客様はいません。</p>
                  ) : (
                    data.vipCustomers.map((c) => {
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
                          {c.voice && <p className="vip-voice">「{c.voice}」</p>}
                        </div>
                      );
                    })
                  )}
                </div>
                <p className="note-fine">
                  ※顧客名はレジでの判別補助のためこの画面でのみ表示します（原則7）。
                </p>
              </div>
            </Card>

            {/* 4. ティア別の内訳（当期・店舗全体）。件数が主・¥は従（原則・金額を主役にしない） */}
            <Card>
              <div className="stack-md">
                <h2 className="headline-sm">ティア別の内訳</h2>
                <div className="pill-row">
                  {data.tierBreakdown.map((t) => (
                    <span
                      key={t.label}
                      className="stat-pill"
                      title={`${t.label}：${t.count}件・${yen(t.revenue)}`}
                    >
                      <span className="stat-pill-label">{t.label}</span>
                      <span className="stat-pill-count">{t.count}</span>
                    </span>
                  ))}
                </div>
                {/* ティア別の売上（§18 C）。rating_purchases.amount の実値合計なので
                    総和は上部の店舗合計¥と必ず一致する。件数の下に小さく置く。 */}
                <p className="note-fine">
                  {data.tierBreakdown.map((t, i) => (
                    <span key={t.label}>
                      {i > 0 && " ・ "}
                      {t.label} {yen(t.revenue)}
                    </span>
                  ))}
                </p>
                <p className="note-fine">
                  ※金額は店舗合計です。スタッフ個人には割り付けません（原則5）。
                </p>
              </div>
            </Card>

            {/* 5. スタッフ別の評価（件数/ティア内訳/リアルボイス/前期間比のみ・¥は出さない） */}
            <Card>
              <StaffPeriodView
                staffNames={data.staffNames}
                staffRole={data.staffRole}
                staffArchived={data.staffArchived}
                cur={data.cur}
                prev={data.prev}
                label={label}
              />
            </Card>

            {/* 6. 最近の評価（時刻・顧客名・スタッフ名・ティア・§20 決定3）。並びは時刻順・ティアの色は変えない。
                スマホ幅（<=520px）では2段: 1段目「日付・ティア」／2段目「○○様 → スタッフ名」（§20 追加決定2）。
                .recent-who はパソコン幅では display: contents（包みが無いのと同じ）で、1段の並びは従来のまま。
                矢印（.recent-arrow）はスマホ幅でだけ出す。 */}
            <Card>
              <div className="stack-md">
                <h2 className="headline-sm">最近の評価</h2>
                <div>
                  {data.recent.length === 0 ? (
                    <p className="muted">対象期間の評価はまだありません。</p>
                  ) : (
                    data.recent.map((r, i) => (
                      <div key={i} className="recent-row">
                        <span className="recent-time">{r.time}</span>
                        <span className="recent-who">
                          <span className="recent-customer">{r.customer}様</span>
                          <span className="recent-arrow" aria-hidden="true">
                            →
                          </span>
                          <span className="recent-name">{r.staff}</span>
                        </span>
                        <span className="recent-tier">{r.tier}</span>
                      </div>
                    ))
                  )}
                </div>
                {/* もっと見る（§20 決定4）。§17・§22 と同じ「成長する take」＝毎回先頭から take 件。
                    リンクにはいま見ている期間を引き継ぐ（落とすと「今月」に戻る）。
                    上限に達したら打ち切る（URL を直接いじられても増え続けない）。 */}
                {data.recent.length > 0 &&
                  (data.recentHasMore && recentTake < RECENT_MAX_TAKE ? (
                    <Link
                      href={dashboardHref(
                        period,
                        recentTake + RECENT_PAGE_SIZE,
                        basePath,
                      )}
                      className="btn btn-quiet btn-block"
                      scroll={false}
                    >
                      もっと見る
                    </Link>
                  ) : (
                    <p className="note-fine center-text">
                      すべて表示しました（{data.recent.length}件）
                    </p>
                  ))}
              </div>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
