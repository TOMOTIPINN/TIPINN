import Link from "next/link";
import { requireOwnerSalon } from "@/lib/owner-guard";
import { Eyebrow, Card } from "@/components/ui";
import InboxList from "@/app/manager/inbox/InboxList";
import {
  getInboxData,
  inboxHref,
  parseScope,
  parseTake,
  INBOX_SCOPES,
  INBOX_PAGE_SIZE,
} from "@/app/manager/inbox/inbox-data";
import OwnerSalonNav from "@/app/owner/OwnerSalonNav";

/**
 * オーナーが見る、1店舗ぶんの感想の一覧（/owner/[salonId]/inbox・§21 コミット3c）。
 *
 * ★/manager/inbox と同じ一覧を出す★（§21 決定1「店舗を切り替えて、既存の店長画面と
 *   同じものを見る」）。顧客名・公開範囲バッジ・ティアバッジ・本文まで同じ。
 *   集計は `inbox-data.ts` を salonId 引数で流用する（**複数店舗には広げない**）。
 *
 * ★各行を詳細（/staff/received/[reviewId]）へのリンクにしない★（2026-09-23 決定）
 *   詳細画面は `getStaffContext()` で認可しており、オーナーが他店舗の感想を開くと
 *   `ctx.salon_id` が一致せず 404 になる。**オーナー用の詳細画面も作らない**。
 *   詳細にしかない情報は**タグ**と**「今週 N」**の2つだけで、
 *   タグを一覧に出すかは店長画面にも関わる別の判断として切り離した。
 *   `/owner` から `/staff/*` へのリンクを出さない条件も、これで満たす。
 *
 * 認可: `requireOwnerSalon()`（3b と同じ）。未ログイン→LINEログイン／非オーナー→/staff／
 *   自分の組織配下でない salonId → 404。データ取得には**照合を通った `salon.id`**
 *   を使う（パスの文字列をそのまま DB に渡さない・`50_security.md` §1.1）。
 *
 * URL で持つ状態（`?scope=` / `?take=`）は、この画面の中で完結させる
 *   ＝ `inboxHref` の basePath をこのページ自身にする（`/manager/inbox` に飛ばさない）。
 *
 * トーン: ¥は扱わない（金額は select しない・原則5）。赤は使わない。
 *   インライン style 禁止（globals.css のトークンのみ・§8）。
 */
export const dynamic = "force-dynamic";

export default async function OwnerSalonInboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ salonId: string }>;
  searchParams: Promise<{ scope?: string; take?: string }>;
}) {
  const { salonId } = await params;
  const basePath = `/owner/${salonId}/inbox`;

  const { salon } = await requireOwnerSalon(salonId, basePath);

  const { scope: rawScope, take: rawTake } = await searchParams;
  const scope = parseScope(rawScope);
  const take = parseTake(rawTake);

  const { rows, counts, hasMore } = await getInboxData(salon.id, scope, take);

  return (
    <main className="page page-top" data-role="owner">
      <div className="container stack animate-in">
        <OwnerSalonNav salonId={salon.id} active="inbox" />

        <header className="stack-sm">
          <Eyebrow className="eyebrow-mint">Owner inbox</Eyebrow>
          <h1 className="headline">{salon.name} ・ 感想の一覧</h1>
        </header>

        {/* 公開範囲フィルタ（§17）。クライアント JS を足さず Link 遷移で切り替える。
            遷移先は basePath ＝この画面自身（/manager/inbox には飛ばさない）。 */}
        <nav className="inbox-stat-row" aria-label="公開範囲で絞り込む">
          {INBOX_SCOPES.map((s) => {
            const active = s.value === scope;
            return (
              <Link
                key={s.value}
                href={inboxHref(s.value, INBOX_PAGE_SIZE, basePath)}
                className={`inbox-stat${active ? " is-active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                <span className="inbox-stat-label">{s.label}</span>
                <span className="inbox-stat-value">{counts[s.value] ?? 0}</span>
              </Link>
            );
          })}
        </nav>

        <Card>
          {rows.length === 0 ? (
            <p className="muted center-text">
              {scope === "all"
                ? "まだ感想は届いていません。"
                : "この公開範囲の感想はまだありません。"}
            </p>
          ) : (
            /* linkRows={false}＝行を詳細へのリンクにしない（上のコメント参照）。 */
            <InboxList rows={rows} linkRows={false} />
          )}
        </Card>

        {rows.length > 0 &&
          (hasMore ? (
            <Link
              href={inboxHref(scope, take + INBOX_PAGE_SIZE, basePath)}
              className="btn btn-quiet btn-block"
            >
              もっと見る
            </Link>
          ) : (
            <p className="note-fine center-text">
              すべて表示しました（{rows.length}件）
            </p>
          ))}

        <p className="note-fine">
          上の件数はこの店舗の全件です。{INBOX_PAGE_SIZE}件ずつ読み込みます。
          公開範囲はお客様が選んだもので、変更はできません。金額はこの画面では扱いません（原則5）。
        </p>
      </div>
    </main>
  );
}
