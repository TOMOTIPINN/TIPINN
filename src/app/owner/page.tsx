import Link from "next/link";
import { requireOwnerPage } from "@/lib/owner-guard";
import { Card } from "@/components/ui";
import RoleBar from "@/components/RoleBar";
import {
  getSalonHeadline,
  type SalonHeadline,
} from "@/app/dashboard/dashboard-data";
import { resolvePeriod } from "@/app/dashboard/period";
import { yen } from "@/app/dashboard/eval-data";
import DeltaPct from "@/app/dashboard/DeltaPct";

/**
 * オーナートップ（/owner・§21 コミット3a → 3b でリンク化 → 3d-1 で数字を追加）。
 *
 * ★店舗単位の比較は、別の枠を作らずこの一覧の各行に数字を足す★（§21 決定3・2026-09-23）
 *   1行＝**店舗名＋今月の数字**で、行全体を押すとその店舗の
 *   `/owner/[salonId]/dashboard` が開く。
 *
 * 出す数字は**各店舗のダッシュボードの「今月」と同じもの**:
 *   感想件数・評価スタンプ件数・評価スタンプ売上（店舗合計）と、それぞれの前月比。
 *
 * ★一覧とダッシュボードの数字を必ず一致させる★
 *   期間は `resolvePeriod({})`＝ダッシュボードの既定と同じ「今月」の窓を使い、
 *   集計は `getSalonHeadline`（`dashboard-data.ts`）＝ダッシュボードと
 *   **同じ `resolvePeriodWindows` と同じ `computeSalonTotals`** を呼ぶ。
 *   **別の集計は書いていない。**
 *
 * ★`getDashboardData` は呼ばない★（§21 設計上の要点）
 *   あちらを複数店舗に広げると `staffNames`（名前文字列キー）で集計が合流して壊れる。
 *   1店舗ずつ呼ぶ手もあるが、VIP・最近の評価・echo flow・ティア内訳まで毎回計算して
 *   捨てることになる。**店舗合計しか使わない部分だけを切り出した `getSalonHeadline` を
 *   店舗ごとに呼ぶ**（スタッフ別には一切触れないので同名スタッフの問題は起きない）。
 *
 * 並び順は**登録順（`salons.created_at` 昇順）のまま**。
 *   **数字の多い順に並べ替えない**（順位を作らない・§4.5）。
 *   並び順・業態でのまとめ表示は **3d-2** で扱う（店舗に「業態」を持たせて
 *   業態ごとにまとめる方式に決定。実装時期は未定）。今回は作らない。
 *
 * 配色: 前月比は上昇＝ミント（`.trend-up`）／横ばい・下降＝既定グレー。**赤は使わない。**
 *   **数字が低い店舗を強調しない**（しきい値の色分けをしない＝`/admin/salons` と同じ作法）。
 *   スタッフ別の数字・¥ は出さない（**店舗合計の売上だけ**・原則5）。
 *
 * 認可: `requireOwnerPage()`（未ログイン→LINEログイン／非オーナー→/staff）。
 *   判定は `organization_members` のみで、`staff.role` は見ない（§21 決定2）。
 *   **layout.tsx には置かない**（既存の作法どおり page の冒頭で行う）。
 *   数字を引く `salon.id` は **DB 由来**（`ctx.salons`）で、URL からは受け取らない。
 *
 * トーン: サロンUI。ロールは常に owner＝`data-role="owner"` で --accent は bronze。
 *   インラインstyle禁止（globals.css の `.owner-salon-*` トークンのみ・§8）。
 *
 * ナビ（SalonNav）は出さない。**`/manager/*` ・ `/staff/*` への導線はこの画面から出さない。**
 */
export const dynamic = "force-dynamic";

/** 1店舗ぶんの行。行全体がその店舗のダッシュボードへのリンク。 */
function SalonRow({
  salonId,
  name,
  headline,
}: {
  salonId: string;
  name: string;
  headline: SalonHeadline;
}) {
  const { cur, prev } = headline;
  const stats = [
    {
      label: "感想",
      value: `${cur.reviewCount}件`,
      prevValue: prev.reviewCount,
      curValue: cur.reviewCount,
    },
    {
      label: "評価スタンプ",
      value: `${cur.ratingCount}件`,
      prevValue: prev.ratingCount,
      curValue: cur.ratingCount,
    },
    {
      label: "売上（店舗合計）",
      value: yen(cur.revenue),
      prevValue: prev.revenue,
      curValue: cur.revenue,
    },
  ];

  return (
    <Link href={`/owner/${salonId}/dashboard`} className="owner-salon-row">
      <span className="owner-salon-name">{name}</span>
      <span className="owner-salon-stats">
        {stats.map((s) => (
          <span key={s.label} className="owner-salon-stat">
            <span className="owner-salon-stat-label">{s.label}</span>
            <span className="owner-salon-stat-value">{s.value}</span>
            <span className="owner-salon-stat-delta">
              前月比 <DeltaPct prev={s.prevValue} cur={s.curValue} />
            </span>
          </span>
        ))}
      </span>
    </Link>
  );
}

export default async function OwnerHomePage() {
  const ctx = await requireOwnerPage("/owner");

  // 期間は引数なしの resolvePeriod＝ダッシュボードの既定と同じ「今月」。
  // 同じ窓を使うことが、一覧と各店舗のダッシュボードの数字が一致する根拠。
  const period = resolvePeriod({});

  // 店舗ごとに1回ずつ（並列）。クエリ本数は「店舗数 × 2本」で、スタッフ数には依存しない。
  const headlines = await Promise.all(
    ctx.salons.map((salon) =>
      getSalonHeadline(salon.id, period.periodStart, period.periodEnd),
    ),
  );

  return (
    <main className="page page-top" data-role="owner">
      <div className="container stack animate-in">
        <RoleBar role="owner" />

        {/* ロール表示は RoleBar（"Owner"）が担う。ここに Eyebrow で "Owner" を重ねない。 */}
        <header className="stack-sm">
          <h1 className="headline">{ctx.org_name}</h1>
          <p className="muted">
            この会社が運営している店舗です。数字は{period.label}（JST）で、
            店舗名を選ぶとその店舗の詳しい数字を見られます。
          </p>
        </header>

        <Card>
          {ctx.salons.length === 0 ? (
            <p className="muted center-text">
              まだ店舗が登録されていません。
            </p>
          ) : (
            <div className="stack stack-sm">
              {/* ★`stack` を必ず併記する★ `.stack-sm` は gap だけの修飾クラスで、
                  単体ではコンテナが flex にならない（globals.css の `.stack` / `.stack-sm`）。

                  並びは salons.created_at 昇順（登録順）。**数字の多い順には並べ替えない**。
                  並び順・業態でのまとめは §21 コミット3d-2（実装時期は未定）。
                  リンク先は /owner/[salonId]/dashboard のみ。/manager ・ /staff へは出さない。 */}
              {ctx.salons.map((salon, i) => (
                <SalonRow
                  key={salon.id}
                  salonId={salon.id}
                  name={salon.name}
                  headline={headlines[i]}
                />
              ))}
            </div>
          )}
        </Card>

        <p className="note-fine">
          前月比は直前の同じ長さの期間との比較です。上昇はミントで示し、下降に色は付けません
          （店舗を順位づけないため）。スタッフ別の数字とスタッフ個人の金額は、この画面では扱いません（原則5）。
        </p>
      </div>
    </main>
  );
}
