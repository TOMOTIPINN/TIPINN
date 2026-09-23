import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";
import { Eyebrow, Card } from "@/components/ui";
import InboxList from "./InboxList";
import SalonNav from "@/components/SalonNav";
import { resolveSalonRole } from "@/lib/display-role";
import {
  getInboxData,
  inboxHref,
  parseScope,
  parseTake,
  INBOX_SCOPES,
  INBOX_PAGE_SIZE,
} from "./inbox-data";

/**
 * 11 店長 Inbox（画面マップ11・サロンUI世界）。ルート: /manager/inbox
 *
 * 同サロンの感想を新着順に一覧。各行には **お客様が選んだ公開範囲
 * （reviews.share_scope）** を表示する。**店長はこれを変更できない**。
 *
 * ★§17（2026-09-17）で公開範囲の絞り込みを足した★
 *   上部の件数ピルが [全部 / 店長のみ / お店のスタッフに] のフィルタになる。
 *   状態は URL（`?scope=`）に持つ＝リロード・戻るでそのまま復元でき、リンクで共有できる。
 *   **絞り込みはサーバー側の `eq` で行う**（件数と行が同じ条件から出る）。
 *   → docs/40_decisions.md §17
 *
 * ★§16（2026-09-17）で店長のキュレーションを廃止した★
 *   以前は各行に [全員に共有 / 店長控え] のトグルがあり reviews.visibility を更新していたが、
 *   visibility はスタッフ側の表示判定（@/lib/review-visibility）にも購入条件
 *   （@/lib/review-purchase）にも使われておらず、「店長控え＝スタッフに表示されない」という
 *   この画面の説明と実装が食い違っていた（2026-09-17 調査）。
 *   低評価の言葉は店長が受け止め（docs/00_philosophy.md §4.8）、`manager_only` はお客様の選択で
 *   すでに担保されている。表示条件に「店長の判断」という3つ目の軸を足さない。
 *   → docs/40_decisions.md §16。**visibility 列は DB に残すが読み書きしない。**
 *
 * ★§20 決定1（2026-09-22）で各行にティアバッジを足した★
 *   その感想に紐づく評価スタンプ（rating_purchases.tier）を、公開範囲の隣に
 *   **同じ褪せグレー（.tag-quiet）**で出す。取るのは review_id, tier だけで、
 *   **amount は select しない**（金額はこの画面では扱わない・原則5）。
 *   並び・件数・ページングは変えない（ティア順に並べ替えない・集計しない＝§20 ガードレール）。
 *   過去21件の購入は review_id が null（§13 決定6）なので、新しい購入にしかバッジは付かない。
 *
 * トーン: 暖色＋ミント・ゴシック・**¥なし**（金額は select しない・§4）。
 *
 * 認証（方式B / [[auth-method-line-b]]）: ログイン中の LINE から getStaffContext() を解決。
 *   未ログイン → returnTo付きで LINE ログインへ。role!=='manager' は閲覧不可。
 *   サロンは ctx.salon_id にスコープ（?salon= は受け取らない＝越境不可）。
 */

export default async function ManagerInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; take?: string }>;
}) {
  const { scope: rawScope, take: rawTake } = await searchParams;
  const scope = parseScope(rawScope);
  const take = parseTake(rawTake);

  const session = await getSession();
  if (!session) {
    redirect(
      `/api/auth/line/login?returnTo=${encodeURIComponent("/manager/inbox")}`,
    );
  }

  const ctx = await getStaffContext();
  if (!ctx) {
    return (
      <main className="page">
        <p className="muted center-text">
          このアカウントはスタッフとして登録されていません。
        </p>
      </main>
    );
  }
  if (ctx.role !== "manager") {
    return (
      <main className="page">
        <p className="muted center-text">
          この画面は店長のみ閲覧できます。
        </p>
      </main>
    );
  }

  const salonId = ctx.salon_id;
  const { data: salon } = await supabaseAdmin
    .from("salons")
    .select("name")
    .eq("id", salonId)
    .single();

  if (!salon) {
    return (
      <main className="page">
        <p className="muted center-text">サロンが見つかりませんでした。</p>
      </main>
    );
  }

  // 一覧・件数・続きの有無は inbox-data.ts に集約（§21 コミット3c で切り出した。
  //   処理・順序・クエリは従来どおり）。salon は ctx.salon_id にスコープ（越境不可）。
  const { rows, counts, hasMore } = await getInboxData(salonId, scope, take);

  const displayRole = await resolveSalonRole(ctx);

  return (
    <main className="page page-top" data-role={displayRole}>
      <div className="container stack animate-in">
        <SalonNav role={displayRole} />
        <header className="stack-sm">
          <Eyebrow className="eyebrow-mint">Manager inbox</Eyebrow>
          <h1 className="headline">{salon.name} ・ 感想の一覧</h1>
        </header>

        {/* 公開範囲フィルタ（§17）。クライアント JS を足さず Link 遷移で切り替える。
            アクティブはミント（30_design.md §2 が「アクティブタブ」をミントの許可用途に挙げている）。
            バッジをグレーに統一した §16 と矛盾しない＝あちらは状態表示・こちらは選択中のタブ。 */}
        <nav className="inbox-stat-row" aria-label="公開範囲で絞り込む">
          {INBOX_SCOPES.map((s) => {
            const active = s.value === scope;
            return (
              <Link
                key={s.value}
                href={inboxHref(s.value, INBOX_PAGE_SIZE)}
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
            <InboxList rows={rows} />
          )}
        </Card>

        {rows.length > 0 &&
          (hasMore ? (
            <Link
              href={inboxHref(scope, take + INBOX_PAGE_SIZE)}
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
          上の件数はこのサロンの全件です。{INBOX_PAGE_SIZE}件ずつ読み込みます。
          公開範囲はお客様が選んだもので、店長は変更できません。金額はこの画面では扱いません（原則5）。
        </p>
      </div>
    </main>
  );
}
