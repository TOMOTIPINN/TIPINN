import { supabaseAdmin } from "@/lib/supabase-admin";
import { REVIEW_RATINGS, SHARE_SCOPES, type ShareScope } from "@/lib/review";
import { getTier } from "@/lib/rating-tiers";
import { jstMonthDayTime } from "@/lib/jst-format";
import type { InboxRow } from "./InboxList";

/**
 * 店長 Inbox の集計・URL 解釈層（server 専用・§21 コミット3c で page.tsx から切り出した）。
 *
 * ★切り出しただけで、処理・順序・クエリは一切変えていない★
 *   `/manager/inbox/page.tsx` と `/owner/[salonId]/inbox/page.tsx` が
 *   **同じ一覧**を出すための単一ソース。読者（店長／オーナー）で中身は変えない。
 *
 * ★salonId は引数で受ける。複数店舗には広げない★
 *   呼び出し側が「1サロンぶんを1回」呼ぶ（§21 設計上の要点）。
 *   `/manager` はセッション由来の `ctx.salon_id`、`/owner` は `requireOwnerSalon` の
 *   照合を通った `salon.id`。どちらも**クライアント入力をそのまま渡さない**。
 *
 * ¥は扱わない（`rating_purchases.amount` を select しない・原則5）。
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
export type InboxScope = "all" | ShareScope;

export const INBOX_SCOPES: { value: InboxScope; label: string }[] = [
  { value: "all", label: "全部" },
  ...SHARE_SCOPES.map((s) => ({ value: s.value, label: s.label })),
];

/** 1回に読み込む件数。初回もこの数で、「もっと見る」1回につきこの数だけ増える。 */
export const INBOX_PAGE_SIZE = 50;

/**
 * take の上限。PostgREST は max-rows（既定 1000）を超えると
 * **エラーにならず静かに切り捨てる**ため、その手前で止める
 * （src/lib/fetch-all-rows.ts:3-5）。実運用で到達する想定は無い。
 */
export const INBOX_MAX_TAKE = 1000;

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
export function parseTake(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= INBOX_PAGE_SIZE) return INBOX_PAGE_SIZE;
  const rounded = Math.ceil(n / INBOX_PAGE_SIZE) * INBOX_PAGE_SIZE;
  return Math.min(rounded, INBOX_MAX_TAKE);
}

/**
 * フィルタと読み込み深さを URL に載せる。scope=all・1ページ目はクエリ無しの素の URL にする。
 *
 * `basePath` の既定は `/manager/inbox`（店長画面・従来どおり）。
 * `/owner/[salonId]/inbox` から流用するときだけ差し替える（§21 コミット3c）。
 */
export function inboxHref(
  scope: InboxScope,
  take: number,
  basePath: string = "/manager/inbox",
): string {
  const params = new URLSearchParams();
  if (scope !== "all") params.set("scope", scope);
  if (take !== INBOX_PAGE_SIZE) params.set("take", String(take));
  const q = params.toString();
  return q ? `${basePath}?${q}` : basePath;
}

/** 不正値・未指定は既定の 'all' に落とす（エラー画面は出さない）。 */
export function parseScope(raw: string | undefined): InboxScope {
  return INBOX_SCOPES.some((s) => s.value === raw)
    ? (raw as InboxScope)
    : "all";
}

export type InboxData = {
  rows: InboxRow[];
  /** 上部のピルに出す件数。キーは InboxScope。 */
  counts: Record<string, number>;
  hasMore: boolean;
};

/**
 * 一覧・件数・続きの有無をまとめて返す（1サロンぶん）。
 * 処理の順序・クエリは page.tsx にあったものそのまま。
 */
export async function getInboxData(
  salonId: string,
  scope: InboxScope,
  take: number,
): Promise<InboxData> {
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

  return { rows, counts, hasMore };
}
