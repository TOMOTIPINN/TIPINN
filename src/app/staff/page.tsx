import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";
import { Eyebrow, Card } from "@/components/ui";
import RoleBar from "@/components/RoleBar";
import AddFriendCard from "@/components/AddFriendCard";
import { resolveSalonRole } from "@/lib/display-role";
import { getTier } from "@/lib/rating-tiers";
import { REVIEW_RATINGS } from "@/lib/review";
import {
  STAFF_BODY_MIN_RATING,
  STAFF_VISIBLE_SHARE_SCOPE,
} from "@/lib/review-visibility";
import {
  GREETING_LABEL,
  jstGreeting,
  jstPeriodStartISO,
  rankForCount,
  PAID_STAMPS_ENABLED,
  RANK_ENABLED,
} from "@/lib/staff-stats";

/**
 * 12 スタッフホーム（画面マップ12・サロンUI世界）。ルート: /staff
 *
 * 蓄積（件数）＋「あなたに届いた声」＋ Team voices を表示する。
 *   トーン: 暖色＋ミント・ゴシック・**¥なし**（§2/§4）。
 *   集計は staff_id 軸（感想＋有料評価の件数のみ）。金額列は select しない。
 *
 * 13 スタッフ通知（/staff/received/[reviewId]）への導線はこの画面が持つ:
 *   ・「あなたに届いた声」… 自分宛ての新着5件（全行リンク）。§14 決定3 で
 *       **rating<=2 でも有料スタンプが贈られたものは本文なしの行で出す**ようになった
 *   ・Team voices        … 開ける行だけリンク（canOpen が detail の canView と同条件）。
 *       **本文を出す一覧なので rating>=3 のまま**（§14 決定1・低評価の本文は店長のみ）
 *
 * 認証（方式B / [[auth-method-line-b]]）: ログイン中の LINE から getStaffContext() で
 *   staff_id/salon_id を解決。?staff= は受け取らない（自分のデータのみ）。
 *   未ログイン → returnTo付きで LINE ログインへ。staff 未紐付け → 参加案内。
 */

type VoiceRow = {
  id: string;
  body: string;
  rating: number | null;
  created_at: string;
  share_scope: string | null;
  /** 宛先スタッフ（null＝サロン全体宛）。リンク可否の判定にのみ使う。 */
  staff_id: string | null;
  staff: { name: string } | { name: string }[] | null;
};

/**
 * 「あなたに届いた声」の1行（自分宛て・件数ではなく中身を出す）。
 * §14 決定3 で2種類になった。判別は mode で行う。
 *   full       … rating>=3。従来どおり本文つき
 *   stamp_only … rating<=2 で有料スタンプが贈られたもの。**本文も rating も持たない**
 *                （持たせないために select 自体を分けている）
 * ★stamp_only の行に顧客名・ティアは出さない★（§13 決定2 を維持）。
 *   名前とティアは詳細（/staff/received/[reviewId]）でだけ出す。
 */
/** (1) rating>=3 のクエリが返す行（mode を付ける前）。 */
type MyHighRow = {
  id: string;
  body: string;
  rating: number | null;
  created_at: string;
};

/** (2) rating<=2 のクエリが返す行。**body も rating も持たない**（select していない）。 */
type MyLowRow = { id: string; created_at: string };

type MyVoiceRow =
  | ({ mode: "full" } & MyHighRow)
  | ({ mode: "stamp_only" } & MyLowRow);

/**
 * 「あなたに届いた声」の1回の読み込み件数。初回もこの数で、
 * 「もっと見る」1回につきこの数だけ増える（§22 決定3・Inbox の INBOX_PAGE_SIZE と同じ役割）。
 */
const MY_VOICES_PAGE_SIZE = 5;

/**
 * take の上限。PostgREST は max-rows（既定 1000）を超えると
 * **エラーにならず静かに切り捨てる**ため、その手前で止める（`src/lib/fetch-all-rows.ts:3-5`）。
 * Inbox の `INBOX_MAX_TAKE` と**同じ理由・同じ値**。実運用で到達する想定は無い。
 */
const MY_VOICES_MAX_TAKE = 1000;

/**
 * Team voices（同サロンの新着）の表示件数。
 * ★ここには「もっと見る」を付けない★（§22 決定5。眺める面であってアーカイブではない。
 * 全件を読み切る役割は /manager/inbox＝§17 が持つ）。
 * MY_VOICES_PAGE_SIZE と**偶然同じ値**なので、片方だけ動かす事故を防ぐため定数を分けてある。
 */
const TEAM_VOICES_LIMIT = 5;

/**
 * `?take=` を読む。不正値・未指定は1ページ目。
 * ページサイズの倍数に切り上げ、上限で丸める（URL を直接いじられても壊れない）。
 * **`manager/inbox` の `parseTake` と同じ作法**（§22 決定3）。
 */
function parseTake(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= MY_VOICES_PAGE_SIZE) return MY_VOICES_PAGE_SIZE;
  const rounded = Math.ceil(n / MY_VOICES_PAGE_SIZE) * MY_VOICES_PAGE_SIZE;
  return Math.min(rounded, MY_VOICES_MAX_TAKE);
}

/**
 * 読み込み深さを URL に載せる。**1ページ目はクエリ無しの素の `/staff`** にする。
 * ★載せるのは take だけ★ `?salon=` は受け取らない（サロンは ctx.salon_id 固定・§22 決定4・§8）。
 */
function staffHref(take: number): string {
  const params = new URLSearchParams();
  if (take !== MY_VOICES_PAGE_SIZE) params.set("take", String(take));
  const q = params.toString();
  return q ? `/staff?${q}` : "/staff";
}

/** 集計スコープ: あなたへ（staff_id 一致）／お店全体（salon_id のみ・staff_id 不問＝あなた宛も含む全レビュー）。 */
type CountScope = { staffId: string } | { salonId: string; wholeSalon: true };

type PeriodCounts = { week: number; month: number; quarter: number };

/**
 * 件数カウント（¥は数えない・件数のみ）。[since, until) の半開区間で絞れる。
 * お店全体（wholeSalon）の salon_id は呼び出し側が必ず ctx.salon_id を渡す
 * （クライアントからは受け取らない構造・§8）。
 */
async function countRows(
  table: "reviews" | "rating_purchases",
  scope: CountScope,
  sinceISO?: string,
  untilISO?: string,
): Promise<number> {
  let q = supabaseAdmin.from(table).select("id", { count: "exact", head: true });
  if ("staffId" in scope) {
    q = q.eq("staff_id", scope.staffId);
  } else {
    // お店全体＝salon_id のみで絞る（staff_id 不問。あなた宛・他スタッフ宛・全体宛すべて）。
    q = q.eq("salon_id", scope.salonId);
  }
  if (sinceISO) q = q.gte("created_at", sinceISO);
  if (untilISO) q = q.lt("created_at", untilISO);
  const { count } = await q;
  return count ?? 0;
}

const APPRECIATION_ROWS: { label: string; key: keyof PeriodCounts }[] = [
  { label: "今週", key: "week" },
  { label: "今月", key: "month" },
  { label: "今期", key: "quarter" },
];

/** マトリクスの値セル。0 は薄く（muted 相当）、単位「件」は数字より一段小さく薄く。¥は出さない。 */
function ValueCell({ n }: { n: number }) {
  return (
    <div className="metric-card">
      <p className={`metric-value${n === 0 ? " is-zero" : ""}`}>
        {n}
        <span className="metric-unit">件</span>
      </p>
    </div>
  );
}

/**
 * Your appreciation のマトリクス（期間=行 / 種類=列）。列見出しは1回だけ。¥は出さない。
 * stamps が null（評価スタンプ非表示）のときは感想の1列だけにする（is-single）。
 */
function AppreciationTable({
  reviews,
  stamps,
}: {
  reviews: PeriodCounts;
  stamps: PeriodCounts | null;
}) {
  return (
    <div className={`appreciation-grid${stamps ? "" : " is-single"}`}>
      {/* 列見出し（左上は空・種類名は1回だけ） */}
      <span aria-hidden="true" />
      <span className="appreciation-colhead">感想</span>
      {stamps && <span className="appreciation-colhead">評価スタンプ</span>}
      {/* 期間ごとの行 */}
      {APPRECIATION_ROWS.map((row) => (
        <Fragment key={row.key}>
          <span className="appreciation-rowhead">{row.label}</span>
          <ValueCell n={reviews[row.key]} />
          {stamps && <ValueCell n={stamps[row.key]} />}
        </Fragment>
      ))}
    </div>
  );
}

function one<T>(v: T | T[] | null): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

const jstDate = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
});

export default async function StaffHomePage({
  searchParams,
}: {
  searchParams: Promise<{ take?: string }>;
}) {
  const { take: rawTake } = await searchParams;
  const take = parseTake(rawTake);

  const session = await getSession();
  if (!session) {
    redirect(`/api/auth/line/login?returnTo=${encodeURIComponent("/staff")}`);
  }

  const ctx = await getStaffContext();
  if (!ctx) {
    return (
      <main className="page">
        <p className="muted center-text">
          このアカウントはスタッフとして登録されていません。
          <br />
          店長から届いた招待リンクから参加してください。
        </p>
      </main>
    );
  }

  const weekStart = jstPeriodStartISO("week");
  const monthStart = jstPeriodStartISO("month");
  const quarterStart = jstPeriodStartISO("quarter");

  // 集計スコープ。お店全体の salon_id は必ず ctx 由来（クライアント非経由・§8）。
  const youScope = { staffId: ctx.staff_id } as const;
  const salonScope = { salonId: ctx.salon_id, wholeSalon: true } as const;

  // Team voices の中身はロールで出し分ける（件数の集計は不変＝数字は全部・中身は選ばれたものだけ）。
  //  ・staff       : share_scope='everyone'（お店のスタッフに共有）かつ rating>=3 のみ
  //                  （rating 1,2 の本文は店長が受け止める・docs/00_philosophy.md §4.8）。
  //                  ここは**本文を出す一覧**なので §14 後も rating>=3 のまま。
  //  ・manager/owner: 従来どおり manager_only 以外・rating 制限なし。
  const displayRole = await resolveSalonRole(ctx);
  // staff_id は「その行を /staff/received/[id] で開けるか」の判定にだけ使う（絞り込み条件は不変）。
  const voicesBase = supabaseAdmin
    .from("reviews")
    .select("id, body, rating, created_at, share_scope, staff_id, staff(name)")
    .eq("salon_id", ctx.salon_id);
  const voicesQuery =
    displayRole === "staff"
      ? voicesBase
          .eq("share_scope", STAFF_VISIBLE_SHARE_SCOPE)
          .gte("rating", STAFF_BODY_MIN_RATING)
      : voicesBase.neq("share_scope", "manager_only");

  /**
   * 「あなたに届いた声」= 自分宛て（staff_id 一致）の感想。
   * salon_id は staff_id から一意に決まるが、越境の保険として二重スコープにする。
   *
   * §14 決定3 でクエリを**2本に分けた**（§19 で (2) の母集団が広がった）:
   *   (1) `full`      … `everyone` かつ rating>=3。従来どおり本文つきで出す
   *   (2) `full` 以外 … 有料スタンプが贈られたものだけ、**本文なし**の行で出す
   *                     （`manager_only` / `null` / `either` / 未知の値 ＋ `everyone` の低評価・null）
   *
   * ★(2) で body を select しない★
   *   本人に見せない本文（docs/00_philosophy.md §4.8）を、
   *   「画面で出さない」ではなく「**取ってこない**」ことで担保する。
   *   **1本のクエリにまとめない**＝まとめると本文を取らざるを得なくなる（§22 決定2）。
   */
  const myHighQuery = supabaseAdmin
    .from("reviews")
    .select("id, body, rating, created_at")
    .eq("salon_id", ctx.salon_id)
    .eq("staff_id", ctx.staff_id)
    .eq("share_scope", STAFF_VISIBLE_SHARE_SCOPE)
    .gte("rating", STAFF_BODY_MIN_RATING)
    .order("created_at", { ascending: false })
    .limit(take);

  /**
   * (1) の件数（`hasMore` の判定用・§22 決定3）。**myHighQuery と同条件**にすること。
   * 一覧側は limit があるので母集団にできない（§17 の Inbox と同じ理由）。
   * low 側は決定1 により**全件取れている**ので数える必要がない（`lowRows.length` がそのまま件数）。
   */
  const myHighCountQuery = supabaseAdmin
    .from("reviews")
    .select("id", { count: "exact", head: true })
    .eq("salon_id", ctx.salon_id)
    .eq("staff_id", ctx.staff_id)
    .eq("share_scope", STAFF_VISIBLE_SHARE_SCOPE)
    .gte("rating", STAFF_BODY_MIN_RATING);

  /**
   * (2) の材料: **自分宛ての有料スタンプを先に引く**（§22 決定1）。
   *
   * ★「`full` 以外を N 件取ってから購入で絞る」と、何件取れば何件表示できるか決められない★
   *   購入は別テーブルにあるので歩留まりが事前に分からない。旧実装は走査幅
   *   （LOW_RATING_SCAN = 20）で誤魔化していたが、**窓から溢れた古い購入済み行は
   *   購入判定にすら載らなかった**（§19 で母集団が「`full` 以外すべて」に広がり当たりやすくなった）。
   *   **購入を先に引けば (2) は最初から「表示できる行」と一致する**＝
   *   走査幅と表示上限の二重管理が消える（§19 未対応4 の解消）。
   *
   * ★amount は select しない★（¥がスタッフ画面に漏れない構造を崩さない・§2/§4）。
   *   tier も表示はしない。**詳細が開けるか**の判定にだけ使う。
   * `review_id` が null の行（§13 決定6 の過去分・遡及しない）は感想に結びつかないので除く。
   */
  const myPurchasesQuery = supabaseAdmin
    .from("rating_purchases")
    .select("review_id, tier")
    .eq("staff_id", ctx.staff_id)
    .not("review_id", "is", null);

  // 感想（reviews）: あなたへ／お店への各グループ×今週/今月/今期 ＋ Team voices。
  const [
    youRvW,
    youRvM,
    youRvQ,
    shopRvW,
    shopRvM,
    shopRvQ,
    voicesRes,
    myHighRes,
    myHighCountRes,
    myPurchasesRes,
  ] = await Promise.all([
    countRows("reviews", youScope, weekStart),
    countRows("reviews", youScope, monthStart),
    countRows("reviews", youScope, quarterStart),
    countRows("reviews", salonScope, weekStart),
    countRows("reviews", salonScope, monthStart),
    countRows("reviews", salonScope, quarterStart),
    voicesQuery.order("created_at", { ascending: false }).limit(TEAM_VOICES_LIMIT),
    myHighQuery,
    myHighCountQuery,
    myPurchasesQuery,
  ]);

  const youReviews: PeriodCounts = {
    week: youRvW,
    month: youRvM,
    quarter: youRvQ,
  };
  const shopReviews: PeriodCounts = {
    week: shopRvW,
    month: shopRvM,
    quarter: shopRvQ,
  };

  // 評価スタンプ（rating_purchases）の件数は PAID_STAMPS_ENABLED のときだけ集計・表示（¥は出さない）。
  let youStamps: PeriodCounts | null = null;
  let shopStamps: PeriodCounts | null = null;
  if (PAID_STAMPS_ENABLED) {
    const [youPvW, youPvM, youPvQ, shopPvW, shopPvM, shopPvQ] =
      await Promise.all([
        countRows("rating_purchases", youScope, weekStart),
        countRows("rating_purchases", youScope, monthStart),
        countRows("rating_purchases", youScope, quarterStart),
        countRows("rating_purchases", salonScope, weekStart),
        countRows("rating_purchases", salonScope, monthStart),
        countRows("rating_purchases", salonScope, quarterStart),
      ]);
    youStamps = { week: youPvW, month: youPvM, quarter: youPvQ };
    shopStamps = { week: shopPvW, month: shopPvM, quarter: shopPvQ };
  }

  // ランク（A/B/C/D）は RANK_ENABLED のときだけ（PAID_STAMPS_ENABLED とは独立）。
  // あなたへ通算（感想＋評価スタンプ）基準＝累積指標のため現在は常に非表示（→ docs/40_decisions.md §4.5）。
  // ⚠️ ティア（👍☕🍰💐👑）別の内訳はこの画面には**そもそも無い**（件数のみ）。ランクとは別物。
  let rank: "A" | "B" | "C" | "D" | null = null;
  if (RANK_ENABLED) {
    const [youRvTotal, youPvTotal] = await Promise.all([
      countRows("reviews", youScope),
      countRows("rating_purchases", youScope),
    ]);
    rank = rankForCount(youRvTotal + youPvTotal);
  }

  const voices = (voicesRes.data ?? []) as VoiceRow[];

  /**
   * 購入のうち**詳細を開けるもの**だけに絞る。
   * ★詳細（/staff/received/[reviewId]）の stamp_only 条件と厳密に一致させる★
   *   向こうは tier を解決できないものを 404 に倒すので、ここでも getTier で絞る。
   *   緩めるとリンク先が 404 になり、締めると届いたスタンプに辿り着けない。
   */
  const stampedLowIds = new Set(
    ((myPurchasesRes.data ?? []) as { review_id: string | null; tier: string | null }[])
      .filter((p) => p.review_id && getTier(p.tier))
      .map((p) => p.review_id as string),
  );
  const stampedIds = Array.from(stampedLowIds);

  /**
   * (2) 本文を出さない側。**★条件は myHighQuery の補集合にする★**（§19 決定3）。
   *
   * ★「manager_only を足す」ではなく「`full` 以外を全部」と書く★
   *   `full` は allow-list（everyone かつ rating>=3・staffViewMode と同じ形）なので、
   *   その否定＝「everyone でない **or** rating>=3 でない」を4項で書き下す。
   *   述語が互いに補集合だから**排他かつ網羅**になる（`.eq` で偶然弾ける、ではない）。
   *
   * ★`is.null` の2項を明示しないと、その行がどちらの一覧にも入らず消える★
   *   PostgREST の neq / lt は SQL の `<>` / `<` で、**3値論理により NULL には TRUE を
   *   返さない**（`share_scope IS NULL` も `rating IS NULL` も両方の一覧から漏れる）。
   *
   *   `.eq("share_scope", …)` を外すだけでも不足で、**manager_only ＋ rating 4 ＋ 購入あり**が
   *   High（everyone でない）にも Low（rating>=3）にも入らず、
   *   **詳細だけ stamp_only を返す＝「課金されたのに /staff に出ない」**が残る
   *   （§13 が購入条件に share_scope を入れた元の問題）。
   *
   * rating が null の行も本文なし側に入れる（本文を出してよい根拠が無いため）。
   * staffViewMode（@/lib/review-visibility）の null 扱いと揃えること。
   *
   * ★`.in("id", stampedIds)` で母集団を購入のあるものに閉じた（§22 決定1）★
   *   走査幅（旧 LOW_RATING_SCAN）は不要になった。件数はそのスタッフの購入数が上限なので
   *   **limit を置かない**（PostgREST の max-rows 1000 に届く規模ではない）。
   *   購入が0件ならクエリ自体を投げない（`in.()` を PostgREST に送らない）。
   */
  const myLowRes =
    stampedIds.length === 0
      ? null
      : await supabaseAdmin
          .from("reviews")
          .select("id, created_at")
          .eq("salon_id", ctx.salon_id)
          .eq("staff_id", ctx.staff_id)
          .in("id", stampedIds)
          .or(
            `share_scope.neq.${STAFF_VISIBLE_SHARE_SCOPE},share_scope.is.null,rating.lt.${STAFF_BODY_MIN_RATING},rating.is.null`,
          )
          .order("created_at", { ascending: false });

  const lowRows = (myLowRes?.data ?? []) as MyLowRow[];

  // 2本を新着順にマージして上位 take 件（既定 MY_VOICES_PAGE_SIZE・「もっと見る」で +5 ずつ）。
  // ★limit はマージ後に掛ける★ クエリ側で5件ずつ取って後から混ぜると順序が壊れる。
  const myVoices: MyVoiceRow[] = [
    ...((myHighRes.data ?? []) as MyHighRow[]).map((v) => ({
      ...v,
      mode: "full" as const,
    })),
    ...lowRows
      .filter((r) => stampedLowIds.has(r.id))
      .map((r) => ({ ...r, mode: "stamp_only" as const })),
  ]
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    .slice(0, take);

  /**
   * まだ続きがあるか（§17 と同じ判定・`take+1` 件を引かない）。
   *   母集団 = (1) の exact count ＋ (2) の件数。
   *   **(2) は決定1 で「表示できる行」だけを全件取っている**ので、`lowRows.length` が
   *   そのまま件数になる（走査窓が無いので「取り切れていないかも」を考えなくてよい）。
   * take の上限に達したときも打ち切る（PostgREST の静かな切り捨てを避ける）。
   */
  const myVoicesTotal = (myHighCountRes.count ?? 0) + lowRows.length;
  const hasMore =
    myVoices.length < myVoicesTotal && take < MY_VOICES_MAX_TAKE;

  /**
   * その行を /staff/received/[id] で開けるか。
   * detail 側の canView（本人宛て or 同サロンの manager）と**厳密に同じ条件**にする。
   * ここを緩めるとリンク先が 404 になり、締めると開けるはずの声に辿り着けない。
   * salon_id はクエリで既に ctx.salon_id に固定済みのため、ここでは見なくてよい。
   */
  const canOpen = (staffId: string | null): boolean =>
    staffId === ctx.staff_id || ctx.role === "manager";

  const greeting = GREETING_LABEL[jstGreeting()];

  return (
    <main className="page page-top" data-role={displayRole}>
      <div className="container stack animate-in">
        <RoleBar role={displayRole} />
        <header className="stack-sm">
          <Eyebrow className="eyebrow-mint">{greeting}</Eyebrow>
          <h1 className="headline">{ctx.name} さん</h1>
        </header>

        <hr className="rule" />

        {/* LINE 公式アカウント 友だち追加（控えめ・dismissible）。PWA アイコンを失っても入口を残す導線。
            env 未設定なら出さない（安全側）。友だち状態は判別不可のため全員に薄く表示し「あとで」で閉じられる。 */}
        {process.env.NEXT_PUBLIC_LINE_ADD_FRIEND_URL && (
          <AddFriendCard url={process.env.NEXT_PUBLIC_LINE_ADD_FRIEND_URL} />
        )}

        {/* 店頭の来店受付（お客様QRを読み取って来店記録）。日々の主動線なので上部に置く。 */}
        <Link href="/staff/visit" className="btn btn-outline btn-block">
          来店受付（QRを読み取る）
        </Link>

        {/* Your appreciation（件数のみ・¥なし・あなたへ／お店への2グループ） */}
        <section className="stack-md">
          <div className="dash-head">
            <Eyebrow className="eyebrow-mint">Your appreciation</Eyebrow>
            {rank && <span className="role-tag">ランク {rank}</span>}
          </div>

          <div className="stack-sm">
            <h2 className="headline-sm">あなたへ</h2>
            <AppreciationTable reviews={youReviews} stamps={youStamps} />
          </div>

          <div className="stack-sm">
            <h2 className="headline-sm">お店全体</h2>
            <p className="muted">（あなたへの分を含む）</p>
            <AppreciationTable reviews={shopReviews} stamps={shopStamps} />
          </div>

          <p className="note-fine">
            件数は「届いた評価の流れ（echo flow）」です。金額・賞与とは連動しません（原則6）。
          </p>
        </section>

        {/* あなたに届いた声（自分宛て・新着5件）。各行が 13 スタッフ通知（/staff/received/[id]）へ。
            ⚠️ **Team voices の staff 経路とは条件が違う**（§19 以後）。こちらは
            「`full`（everyone かつ rating>=3）」＋「**それ以外でも購入があれば** stamp_only」で、
            購入の無い `full` 以外は出ない。上のマトリクスの件数より少なく見えることがある。 */}
        <Card>
          <div className="stack-md">
            <h2 className="headline-sm">あなたに届いた声</h2>
            {myVoices.length === 0 ? (
              <p className="muted">まだ届いた声はありません。</p>
            ) : (
              <div>
                {myVoices.map((v) => {
                  // stamp_only（§14 決定3）: 日付と「評価スタンプが届きました」だけ。
                  // 本文と rating は持っていない。顧客名とティアも**ここには出さない**
                  // （§13 決定2 を維持）。それらは詳細画面でだけ出す。
                  if (v.mode === "stamp_only") {
                    return (
                      <Link
                        key={v.id}
                        href={`/staff/received/${v.id}`}
                        className="team-voice"
                      >
                        <div className="team-voice-head">
                          <span className="team-voice-name">
                            評価スタンプが届きました
                          </span>
                          <span className="team-voice-time">
                            {jstDate.format(new Date(v.created_at))}
                          </span>
                        </div>
                      </Link>
                    );
                  }
                  const mood =
                    REVIEW_RATINGS.find((r) => r.value === v.rating) ?? null;
                  return (
                    <Link
                      key={v.id}
                      href={`/staff/received/${v.id}`}
                      className="team-voice"
                    >
                      <div className="team-voice-head">
                        <span className="team-voice-name">
                          {mood ? (
                            <>
                              <span aria-hidden="true">{mood.emoji}</span>{" "}
                              {mood.label}
                            </>
                          ) : (
                            "感想"
                          )}
                        </span>
                        <span className="team-voice-time">
                          {jstDate.format(new Date(v.created_at))}
                        </span>
                      </div>
                      <p className="team-voice-body">「{v.body}」</p>
                    </Link>
                  );
                })}
              </div>
            )}

            {myVoices.length > 0 &&
              (hasMore ? (
                <Link
                  href={staffHref(take + MY_VOICES_PAGE_SIZE)}
                  className="btn btn-quiet btn-block"
                >
                  もっと見る
                </Link>
              ) : (
                <p className="note-fine center-text">
                  すべて表示しました（{myVoices.length}件）
                </p>
              ))}

            {/* 上のマトリクス（絞り込み無しの件数）とこの一覧（everyone かつ rating>=3）は
                母集団が違うため数が合わない。責めない・理由を伏せない・赤を使わない書き方で
                先に断っておく（§5 トーン / note-fine＝淡いイタリック）。 */}
            <p className="note-fine">
              ※上の件数と一致しないことがあります。お客様が店長にだけ届けたいと選んだ声などは、ここには表示されません。
            </p>
          </div>
        </Card>

        {/* Team voices（同サロンの新着・気づきの声は褪せグレー） */}
        <Card>
          <div className="stack-md">
            <h2 className="headline-sm">Team voices</h2>
            {voices.length === 0 ? (
              <p className="muted">まだ新着の声はありません。</p>
            ) : (
              <div>
                {voices.map((v) => {
                  const vstaff = one(v.staff);
                  const care = (v.rating ?? 4) <= 2; // 低評価＝気づきの声
                  const inner = (
                    <>
                      <div className="team-voice-head">
                        <span className="team-voice-name">
                          {vstaff?.name ?? "サロン全体"}
                        </span>
                        {care && <span className="tag-care">気づきの声</span>}
                        <span className="team-voice-time">
                          {jstDate.format(new Date(v.created_at))}
                        </span>
                      </div>
                      <p className="team-voice-body">「{v.body}」</p>
                    </>
                  );
                  // 開ける行だけリンクにする。開けない行（他人宛て・staff 視点）は
                  // 従来どおり div のまま＝リンク先が 404 になる導線を作らない。
                  return canOpen(v.staff_id) ? (
                    <Link
                      key={v.id}
                      href={`/staff/received/${v.id}`}
                      className="team-voice"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div key={v.id} className="team-voice">
                      {inner}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>

        {displayRole !== "staff" && (
          <Link href="/dashboard" className="btn btn-quiet btn-block">
            ダッシュボードへ
          </Link>
        )}

        {/* よくある質問（スタッフ向け）。/help/staff への唯一の導線なので、
            上の displayRole 条件の外に置き、ロールによらず常に出す。
            見た目は AddFriendCard と同じ .note-fine の1行リンク。 */}
        <Link href="/help/staff" className="note-fine">
          よくある質問 →
        </Link>
      </div>
    </main>
  );
}
