"use client";

import { Card } from "@/components/ui";
import { yen, type FlowStatus, type StaffFlow } from "./eval-data";

/**
 * HR月次ビュー（echo flow・画面マップ14系）。集計は server（dashboard-data.ts）が行い、
 * flows / monthLabels を props で受け取る。
 *
 * 趣旨（CLAUDE.md §12）:
 *  - echo flow＝そのスタッフに月次で「届いた評価の流れ」（感想＋評価スタンプの件数）。
 *    ¥でも順位スコアでもない非金銭の件数指標。離職予兆＝「承認が届かなくなること」。
 *  - 要ケア判定はトレンド（2ヶ月連続減少）で行う。絶対件数の閾値は使わない（若手を不利にしない）。
 *  - おすすめアクションは定型（ルールベース。AI分析ではない）。お客様の声は生のまま表示。
 *
 * 配色（§12）: 好調/上昇＝ミント / 安定＝グレー / 要ケア＝褪せグレー（赤は使わない）。
 * 規制ガード: ¥は「店舗合計」のみ（個人に割り付けない・原則5）。賞与は機械的連動なし（原則6）。
 */

const STATUS_LABEL: Record<FlowStatus, string> = {
  good: "好調",
  stable: "安定",
  care: "要ケア",
};

// 定型アクション（ルールベース・固定文言。AI分析ではない・§12）。
const STATUS_ACTION: Record<FlowStatus, string> = {
  good: "好調です。良い関わり方をチームに共有しましょう。",
  stable: "安定しています。引き続き見守りましょう。",
  care: "最近、承認が届きにくくなっています。1on1で状況を確認し、届いている声を本人に共有しましょう。",
};

// スパークラインの高さレベル（0〜4）。各スタッフ自身の最大件数で相対化する
// （絶対件数では比較しない＝若手を不利にしないため・§12）。
function sparkLevel(count: number, max: number): number {
  if (max <= 0 || count <= 0) return 0;
  return Math.max(1, Math.round((count / max) * 4));
}

export default function HrFlowView({
  flows,
  monthLabels,
  staffRole,
  salonRev,
  label,
}: {
  flows: StaffFlow[];
  monthLabels: string[];
  staffRole: Record<string, string>;
  salonRev: number;
  label: string;
}) {
  // サマリー: 承認が届いている人数（要ケアでなく活動あり）／要ケア人数／チーム評価件数（直近月）。
  // 退職者は在籍者の指標に混ぜない（自然な減少で偽の「要ケア」を出さないため・方針①）。
  const activeFlows = flows.filter((f) => !f.archived);
  const reaching = activeFlows.filter(
    (f) => f.status !== "care" && f.counts.some((c) => c > 0),
  ).length;
  const careFlows = activeFlows.filter((f) => f.status === "care");
  const teamLatest = flows.reduce((s, f) => s + (f.counts[f.counts.length - 1] ?? 0), 0);
  const latestLabel = monthLabels[monthLabels.length - 1] ?? "今月";

  return (
    <div className="stack">
      {/* HR（月次）は選択中の集計期間に連動しない＝常に直近3ヶ月（トレンド判定の設計・§12）。 */}
      <p className="note-fine">
        ※HR（月次）は上部で選択した集計期間に関わらず、常に直近3ヶ月で表示します。
      </p>

      {/* 1. サマリー3枚 */}
      <div className="metric-grid">
        <div className="metric-card">
          <p className="metric-label">承認が届いている</p>
          <p className="metric-value">{reaching}人</p>
          <p className="metric-delta">echo flow が安定〜好調のスタッフ</p>
        </div>
        <div className="metric-card">
          <p className="metric-label">要ケア（減少傾向）</p>
          <p className="metric-value">{careFlows.length}人</p>
          <p className="metric-delta">echo flow が2ヶ月連続で減少</p>
        </div>
        <div className="metric-card">
          <p className="metric-label">チーム評価件数（{latestLabel}）</p>
          <p className="metric-value">{teamLatest}件</p>
          <p className="metric-delta">感想＋評価スタンプ・{latestLabel}</p>
        </div>
      </div>

      {/* 2. 要ケアアラート（赤ではなく ink-soft 左ラインで静かに・§12） */}
      {careFlows.length > 0 && (
        <div role="status" aria-label="要ケアのお知らせ">
          {careFlows.map((f) => (
            <p key={f.staff} className="alert-flow">
              {f.staff} の echo flow が2ヶ月連続で減少しています。
            </p>
          ))}
        </div>
      )}

      {/* 3. 店舗合計¥（既存値を再利用・個人には割り付けない・原則5。色を付けず中立の明朝） */}
      <Card>
        <div className="stack-sm center-text">
          <p className="metric-label">評価スタンプ売上（店舗合計・{label}）</p>
          <p className="metric-value font-elegant">{yen(salonRev)}</p>
          <p className="note-fine">
            店舗の売上です。スタッフ個人には割り付けません（原則5）。
          </p>
        </div>
      </Card>

      {/* 4. echo flow 一覧（直近3ヶ月の評価件数スパークライン＋ステータス＋ボイス＋定型アクション） */}
      <Card>
        <div className="stack-md">
          <h2 className="headline-sm">echo flow（月次の評価の流れ）</h2>
          <p className="muted">
            直近3ヶ月の評価件数（感想＋評価スタンプ）の推移。件数の多寡ではなく
            「増減の傾向」で見ます。
          </p>
          <div>
            {flows.map((f) => (
              <FlowRow
                key={f.staff}
                flow={f}
                monthLabels={monthLabels}
                role={staffRole[f.staff]}
              />
            ))}
          </div>
          <p className="note-fine">
            ※echo flow は「承認が届いているか」を見る非金銭の指標です。件数の絶対値では
            評価せず（若手が不利にならないよう）、増減の傾向だけで要ケアを判定します。
            おすすめアクションは定型（ルールベース）で、お客様の声はそのまま掲載しています。
            賞与とは機械的に連動しません（原則5・6）。
          </p>
        </div>
      </Card>
    </div>
  );
}

// スタッフ1人分の echo flow 行（スパークライン＋3ヶ月推移＋ステータス＋ボイス＋定型アクション）。
function FlowRow({
  flow,
  monthLabels,
  role,
}: {
  flow: StaffFlow;
  monthLabels: string[];
  role: string;
}) {
  const max = Math.max(...flow.counts, 0);
  const trail = monthLabels.map((m, i) => `${m} ${flow.counts[i] ?? 0}`).join(" → ");
  return (
    <div
      className={`flow-row is-${flow.status}${flow.archived ? " is-archived" : ""}`}
    >
      <div className="flow-head">
        <span className="flow-name">{flow.staff}</span>
        <span className="role-tag">{role}</span>
        {flow.archived && <span className="archived-tag">退職</span>}
        {/* 退職者は要ケア等の判定を出さない（自然減少のため）。在籍者のみステータス表示。 */}
        {!flow.archived && (
          <span className="flow-status">
            <span className="flow-dot" aria-hidden="true" />
            {STATUS_LABEL[flow.status]}
          </span>
        )}
      </div>

      <div className="flow-body">
        <div className="spark" aria-hidden="true">
          {flow.counts.map((c, i) => (
            <span
              key={i}
              className={`spark-bar lv-${sparkLevel(c, max)}`}
              title={`${monthLabels[i] ?? ""} ${c}件`}
            />
          ))}
        </div>
        <span className="flow-counts">{trail}件</span>
      </div>

      {flow.voice && <p className="vip-voice">「{flow.voice}」</p>}
      {!flow.archived && (
        <p className="flow-action">{STATUS_ACTION[flow.status]}</p>
      )}
    </div>
  );
}
