import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";
import { Eyebrow, Card } from "@/components/ui";
import { REVIEW_RATINGS, SHARE_SCOPES } from "@/lib/review";
import InboxList, { type InboxRow } from "./InboxList";
import SalonNav from "@/components/SalonNav";
import { resolveSalonRole } from "@/lib/display-role";

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
 * トーン: 暖色＋ミント・ゴシック・**¥なし**（金額は select しない・§4）。
 *
 * 認証（方式B / [[auth-method-line-b]]）: ログイン中の LINE から getStaffContext() を解決。
 *   未ログイン → returnTo付きで LINE ログインへ。role!=='manager' は閲覧不可。
 *   サロンは ctx.salon_id にスコープ（?salon= は受け取らない＝越境不可）。
 */

type Row = {
  id: string;
  body: string;
  rating: number | null;
  created_at: string;
  share_scope: string | null;
  staff: { name: string } | { name: string }[] | null;
  customers: { display_name: string } | { display_name: string }[] | null;
};

function one<T>(v: T | T[] | null): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

const RATING_EMOJI = new Map<number, string>(
  REVIEW_RATINGS.map((r) => [r.value, r.emoji]),
);

const jstStamp = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * 上部のピル＝公開範囲フィルタ（§17）。'all' が既定。
 *
 * 'all' 以外の文言は `@/lib/review` の SHARE_SCOPES をそのまま使う
 * （お客様が感想フォームで見た文字列と同一にする・§16）。ここで言い換えない。
 */
const INBOX_SCOPES = [
  { value: "all", label: "全部" },
  ...SHARE_SCOPES.map((s) => ({ value: s.value as string, label: s.label })),
] as const;

type InboxScope = (typeof INBOX_SCOPES)[number]["value"];

/** 不正値・未指定は既定の 'all' に落とす（エラー画面は出さない）。 */
function parseScope(raw: string | undefined): InboxScope {
  return INBOX_SCOPES.some((s) => s.value === raw)
    ? (raw as InboxScope)
    : "all";
}

export default async function ManagerInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const { scope: rawScope } = await searchParams;
  const scope = parseScope(rawScope);

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

  // 一覧は新着50件（§17 のステップ2で「もっと見る」を足す）。
  // share_scope は 0001 からある中核列なので、フォールバックの再取得はしない
  // （/staff も @/lib/review-server も同様にそのまま select している）。
  //
  // ★並びは created_at だけでなく id まで指定する★
  //   created_at は一意ではない（同一秒の挿入がありうる）。一意キーまで
  //   order に含めないと、ページを跨いだときに境界の行が重複/欠落しうる
  //   （src/lib/fetch-all-rows.ts:20-21 と同じ規約）。
  const rowsQuery = supabaseAdmin
    .from("reviews")
    .select(
      "id, body, rating, created_at, share_scope, staff(name), customers(display_name)",
    )
    .eq("salon_id", salonId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(50);

  // 'all' は絞り込まない（= share_scope が null / either の行もここに出る・§16）。
  const res = await (scope === "all"
    ? rowsQuery
    : rowsQuery.eq("share_scope", scope));

  const rawRows = (res.data ?? []) as unknown as Row[];

  const rows: InboxRow[] = rawRows.map((r) => ({
    id: r.id,
    emoji: RATING_EMOJI.get(r.rating ?? -1) ?? "♥",
    staffName: one(r.staff)?.name ?? "サロン全体",
    customerName: one(r.customers)?.display_name ?? "お客様",
    time: jstStamp.format(new Date(r.created_at)),
    body: r.body,
    shareScope: r.share_scope,
  }));

  /**
   * 上部の件数は **サロン全体** を数える（一覧に出ている行数ではない・§16 決定3）。
   *   一覧は limit があるので、そこを母集団にすると 53 件あるサロンでも「50」と出続け、
   *   SQL と永久に一致しない（この食い違いが §16 の発端）。全体を数えれば
   *   `select share_scope, count(*) … group by 1` とそのまま突き合わせられる。
   *   本文は引かないので head:true の件数のみ（/staff の集計と同じパターン）。
   *
   * **3つを独立に数える**（`neq` で二分しない・'all' を引き算で出さない）。
   *   「全部」が他の2つの合計より多ければ、**未知の share_scope（`either` / null）が
   *   実データにある**というサインになる → HANDOFF 食い違い#1。
   */
  const countScoped = (value: string | null) => {
    const q = supabaseAdmin
      .from("reviews")
      .select("id", { count: "exact", head: true })
      .eq("salon_id", salonId);
    return value === null ? q : q.eq("share_scope", value);
  };

  const [allRes, managerOnlyRes, everyoneRes] = await Promise.all([
    countScoped(null),
    countScoped("manager_only"),
    countScoped("everyone"),
  ]);
  const counts: Record<string, number> = {
    all: allRes.count ?? 0,
    manager_only: managerOnlyRes.count ?? 0,
    everyone: everyoneRes.count ?? 0,
  };

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
                href={s.value === "all" ? "/manager/inbox" : `/manager/inbox?scope=${s.value}`}
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

        <p className="note-fine">
          件数はこのサロンの全件です。一覧は新着50件まで表示します。
          公開範囲はお客様が選んだもので、店長は変更できません。金額はこの画面では扱いません（原則5）。
        </p>
      </div>
    </main>
  );
}
