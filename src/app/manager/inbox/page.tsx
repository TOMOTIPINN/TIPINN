import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";
import { Eyebrow, Card } from "@/components/ui";
import { REVIEW_RATINGS, SHARE_SCOPES, type ShareScope } from "@/lib/review";
import { getTier } from "@/lib/rating-tiers";
import { jstMonthDayTime } from "@/lib/jst-format";
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

/**
 * 上部のピル＝公開範囲フィルタ（§17）。'all' が既定。
 *
 * 'all' 以外の文言は `@/lib/review` の SHARE_SCOPES をそのまま使う
 * （お客様が感想フォームで見た文字列と同一にする・§16）。ここで言い換えない。
 */
type InboxScope = "all" | ShareScope;

const INBOX_SCOPES: { value: InboxScope; label: string }[] = [
  { value: "all", label: "全部" },
  ...SHARE_SCOPES.map((s) => ({ value: s.value, label: s.label })),
];

/** 1回に読み込む件数。初回もこの数で、「もっと見る」1回につきこの数だけ増える。 */
const INBOX_PAGE_SIZE = 50;

/**
 * take の上限。PostgREST は max-rows（既定 1000）を超えると
 * **エラーにならず静かに切り捨てる**ため、その手前で止める
 * （src/lib/fetch-all-rows.ts:3-5）。実運用で到達する想定は無い。
 */
const INBOX_MAX_TAKE = 1000;

/**
 * rating_purchases を `.in("review_id", …)` で引くときの1回あたりの件数。
 * take は最大 1000 件で、UUID を 1000 個並べると URL 長の上限に当たりうるため
 * 100 件ずつに分けて引く（§20 実装前の判断3・未対応3）。
 * 埋め込み（`rating_purchases(tier)`）は本番の外部キーに依存するので使わない。
 */
const TIER_IN_CHUNK = 100;

/**
 * 表示中の感想に紐づく評価スタンプの tier を review_id → tier の Map で返す。
 * 0047 の部分一意インデックスにより、1つの感想に付く購入は最大1件。
 * 取るのは review_id, tier だけ（**amount は取らない**・原則5）。
 */
async function fetchTierMap(
  salonId: string,
  reviewIds: string[],
): Promise<Map<string, string>> {
  const chunks: string[][] = [];
  for (let i = 0; i < reviewIds.length; i += TIER_IN_CHUNK) {
    chunks.push(reviewIds.slice(i, i + TIER_IN_CHUNK));
  }
  const results = await Promise.all(
    chunks.map((ids) =>
      supabaseAdmin
        .from("rating_purchases")
        .select("review_id, tier")
        .eq("salon_id", salonId)
        .in("review_id", ids),
    ),
  );
  const map = new Map<string, string>();
  for (const res of results) {
    for (const p of (res.data ?? []) as { review_id: string | null; tier: string }[]) {
      if (p.review_id) map.set(p.review_id, p.tier);
    }
  }
  return map;
}

/**
 * `?take=` を読む。不正値・未指定は 1ページ目。
 * ページサイズの倍数に切り上げ、上限で丸める（URL を直接いじられても壊れない）。
 */
function parseTake(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= INBOX_PAGE_SIZE) return INBOX_PAGE_SIZE;
  const rounded = Math.ceil(n / INBOX_PAGE_SIZE) * INBOX_PAGE_SIZE;
  return Math.min(rounded, INBOX_MAX_TAKE);
}

/** フィルタと読み込み深さを URL に載せる。scope=all・1ページ目はクエリ無しの素の URL にする。 */
function inboxHref(scope: InboxScope, take: number): string {
  const params = new URLSearchParams();
  if (scope !== "all") params.set("scope", scope);
  if (take !== INBOX_PAGE_SIZE) params.set("take", String(take));
  const q = params.toString();
  return q ? `/manager/inbox?${q}` : "/manager/inbox";
}

/** 不正値・未指定は既定の 'all' に落とす（エラー画面は出さない）。 */
function parseScope(raw: string | undefined): InboxScope {
  return INBOX_SCOPES.some((s) => s.value === raw)
    ? (raw as InboxScope)
    : "all";
}

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

  // 一覧は新着 take 件（既定 50・「もっと見る」で +50 ずつ・§17）。
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
    .limit(take);

  // 'all' は絞り込まない（= share_scope が null / either の行もここに出る・§16）。
  const res = await (scope === "all"
    ? rowsQuery
    : rowsQuery.eq("share_scope", scope));

  const rawRows = (res.data ?? []) as unknown as Row[];

  // 表示中の行に紐づく tier（§20 決定1）。行の並び・件数には影響しない。
  const tierMap = await fetchTierMap(
    salonId,
    rawRows.map((r) => r.id),
  );

  const rows: InboxRow[] = rawRows.map((r) => ({
    id: r.id,
    emoji: RATING_EMOJI.get(r.rating ?? -1) ?? "♥",
    staffName: one(r.staff)?.name ?? "サロン全体",
    customerName: one(r.customers)?.display_name ?? "お客様",
    time: jstMonthDayTime.format(new Date(r.created_at)),
    body: r.body,
    shareScope: r.share_scope,
    tierLabel: getTier(tierMap.get(r.id))?.label ?? null,
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

  /**
   * まだ続きがあるか。**いま選んでいる scope の全件数**と、実際に描いた行数を比べる。
   *   件数は同じ salon_id・同じ share_scope 条件で数えた exact count なので、
   *   `rows.length < 全件数` はそのまま「続きがある」を意味する。
   *   take+1 件を引いて判定する必要はない（件数をもう持っているため）。
   * take の上限に達したときも打ち切る（PostgREST の静かな切り捨てを避ける）。
   */
  const scopedCount = counts[scope] ?? 0;
  const hasMore = rows.length < scopedCount && take < INBOX_MAX_TAKE;

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
