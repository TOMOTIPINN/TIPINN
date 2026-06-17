import { Card, Eyebrow } from "@/components/ui";

/**
 * 評価ダッシュボード（デモ用モック・画面マップ14系の簡易版・白世界）。
 *
 * ★MVPデモ用。データは全てこのファイル上部のダミー const。
 *   DBクエリ / supabaseAdmin / 認証(getSession)は一切入れていない。
 *   本実装時はこの const 群を「service role の実クエリ＋認証」に差し替える前提
 *   （差し替えやすいよう描画ロジックは const のみに依存させている）。
 *
 * 規制ガード:
 *  - 原則5・6: 評価の可視化であって支払い台帳ではない。金額をスタッフに
 *    紐づけて報酬のように見せない（売上はサロン単位のメトリクスのみ）。
 *  - 原則7: 顧客個人（名前/ID）は一切表示しない。
 */

// ---- ダミーデータ（本実装時にここだけ差し替える） --------------------
const SALON_NAME = "テストサロン";
const PERIOD_LABEL = "今月";

const METRICS = {
  paidStamps: 24, // 受け取った評価スタンプ（件数）
  revenueYen: 38500, // サロン売上（今月・サロン単位。スタッフには紐づけない）
  freeReviews: 57, // 無料レビュー
};

const TIER_BREAKDOWN = [
  { label: "Thank you", count: 8 },
  { label: "Grateful", count: 9 },
  { label: "Wonderful", count: 4 },
  { label: "Amazing", count: 2 },
  { label: "Unforgettable", count: 1 },
];

// スタッフ別「評価」件数（励みの指標。報酬・賞与とは無関係）
const STAFF_RATINGS = [
  { name: "テスト太郎", count: 11 },
  { name: "山田花子", count: 8 },
  { name: "佐藤健", count: 5 },
  { name: "鈴木愛", count: 3 },
];

// 最近の評価（顧客名は持たない・原則7）
const RECENT = [
  { time: "17:35", staff: "テスト太郎", tier: "Wonderful" },
  { time: "16:20", staff: "山田花子", tier: "Grateful" },
  { time: "15:02", staff: "佐藤健", tier: "Thank you" },
  { time: "13:48", staff: "鈴木愛", tier: "Amazing" },
  { time: "11:15", staff: "テスト太郎", tier: "Thank you" },
];
// --------------------------------------------------------------------

// 桁区切り（ロケール非依存・SSR/CSRで一致させる）
function yen(n: number): string {
  return "¥" + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export default function DashboardPage() {
  const barMax = Math.max(...STAFF_RATINGS.map((s) => s.count));

  return (
    <main className="page page-top">
      <div className="container container-wide stack animate-in">
        {/* 1. ヘッダー */}
        <header className="dash-head">
          <div className="stack-sm">
            <Eyebrow>Salon dashboard</Eyebrow>
            <h1 className="headline">{SALON_NAME} ・ 評価ダッシュボード</h1>
          </div>
          <div className="stack-sm center-text">
            <span className="sample-badge">サンプルデータ</span>
            <p className="muted">期間：{PERIOD_LABEL}</p>
          </div>
        </header>

        {/* 2. メトリクス3枚 */}
        <div className="metric-grid">
          <div className="metric-card">
            <p className="metric-label">受け取った評価スタンプ</p>
            <p className="metric-value">{METRICS.paidStamps}</p>
          </div>
          <div className="metric-card">
            <p className="metric-label">サロン売上（今月）</p>
            <p className="metric-value">{yen(METRICS.revenueYen)}</p>
          </div>
          <div className="metric-card">
            <p className="metric-label">無料レビュー</p>
            <p className="metric-value">{METRICS.freeReviews}</p>
          </div>
        </div>

        {/* 3. ティア別の内訳 */}
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

        {/* 4. スタッフ別の評価 */}
        <Card>
          <div className="stack-md">
            <h2 className="headline-sm">スタッフ別の評価</h2>
            <div className="stack-sm">
              {STAFF_RATINGS.map((s) => (
                <div key={s.name} className="bar-row">
                  <span className="bar-name">{s.name}</span>
                  <span className="bar" aria-hidden="true">
                    {Array.from({ length: barMax }).map((_, i) => (
                      <span
                        key={i}
                        className={`bar-seg${i < s.count ? " is-filled" : ""}`}
                      />
                    ))}
                  </span>
                  <span className="bar-value">{s.count}</span>
                </div>
              ))}
            </div>
            <p className="note-fine">
              ※評価は励みのための指標です。賞与・報酬とは連動しません。
            </p>
          </div>
        </Card>

        {/* 5. 最近の評価 */}
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
      </div>
    </main>
  );
}
