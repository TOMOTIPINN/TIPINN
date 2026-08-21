import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";
import { Eyebrow } from "@/components/ui";
import RoleBar from "@/components/RoleBar";
import { resolveSalonRole } from "@/lib/display-role";
import { getTier } from "@/lib/rating-tiers";
import { REVIEW_RATINGS } from "@/lib/review";
import {
  jstPeriodStartISO,
  rankForCount,
  PAID_STAMPS_ENABLED,
  RANK_ENABLED,
} from "@/lib/staff-stats";

/**
 * 13 スタッフ通知（画面マップ13・確定UI＝デッキ v6 P8）。
 * 評価/感想の着信を1件表示する。ルート: /staff/received/[reviewId]
 *
 * 構造（デッキP8厳守・docs/archive/phase5b_staff_screens.md §6）:
 *   ヘッダー → hero（Your work echoes./評価が届きました/from 〇〇様）
 *   → あなたへの評価 ＋N件 → Review（タグ＋本文カード）→ 累計／ランク
 *
 * トーン: サロンUI世界（暖色＋ミント）。ゴシック・明朝不可・細罫線・**¥は一切表示しない**。
 *   金額列（rating_purchases.amount）は **select しない**（¥がスタッフ画面に漏れないことを構造で担保・§2/§4）。
 *
 * 認証（方式B / [[auth-method-line-b]]）: ログイン中の LINE から getStaffContext() を解決。
 *   未ログイン → returnTo付きで LINE ログインへ。閲覧できるのは
 *   ・staff  : 本人宛て（staff_id===自分）かつ share_scope='everyone' かつ rating>=3
 *   ・manager: 同サロンの声すべて（従来どおり絞らない）
 *   それ以外は存在を伏せて notFound()＝**HTTP 404**（他人の評価は見せない）。
 *   「存在しない」と「権限が無い」を区別しない（403 を返さない）のは意図的で、
 *   区別するとレビューIDの総当たりで実在を判別できるオラクルになるため。
 *
 * 到達導線: /staff の Team voices の各行（自分宛て or 同サロンの manager のみリンク化）と、
 *   /staff の「あなたに届いた声」セクション。リンク可否は下の canView と厳密に一致させる。
 */

type ReviewRow = {
  id: string;
  body: string;
  tags: string[] | null;
  rating: number | null;
  created_at: string;
  staff_id: string | null;
  salon_id: string;
  /** お客様が選んだ共有範囲。staff 経路の可視判定に使う（manager は見ない）。 */
  share_scope: string | null;
  customers: { display_name: string } | { display_name: string }[] | null;
};

/** staff_id 軸の評価件数（感想 reviews ＋ 有料評価 rating_purchases）。¥は数えない・件数のみ。 */
async function countEvals(staffId: string, sinceISO?: string): Promise<number> {
  const head = (table: "reviews" | "rating_purchases") => {
    let q = supabaseAdmin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("staff_id", staffId);
    if (sinceISO) q = q.gte("created_at", sinceISO);
    return q;
  };
  // 評価スタンプ（有償）は有償フラグ ON のときだけ加算（staff/page.tsx と扱いを揃える）。
  const tasks = [head("reviews")];
  if (PAID_STAMPS_ENABLED) tasks.push(head("rating_purchases"));
  const results = await Promise.all(tasks);
  return results.reduce((sum, res) => sum + (res.count ?? 0), 0);
}

function one<T>(v: T | T[] | null): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export default async function StaffReceivedPage({
  params,
}: {
  params: Promise<{ reviewId: string }>;
}) {
  const { reviewId } = await params;

  const session = await getSession();
  if (!session) {
    redirect(
      `/api/auth/line/login?returnTo=${encodeURIComponent(`/staff/received/${reviewId}`)}`,
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

  const { data } = await supabaseAdmin
    .from("reviews")
    .select(
      "id, body, tags, rating, created_at, staff_id, salon_id, share_scope, customers(display_name)",
    )
    .eq("id", reviewId)
    .single();

  const review = data as ReviewRow | null;

  /**
   * 閲覧可否。ロールで条件が違う。
   *
   *  ・manager: 自分宛て、または同サロンの声すべて（サロン全体宛 staff_id=null を含む）。
   *      店長は /manager/inbox で全件を受け止める役割なので、ここは絞らない。
   *  ・staff  : 自分宛て（staff_id 一致）**かつ** /staff の Team voices と同じ可視条件
   *      （share_scope='everyone' かつ rating>=3）。
   *      share_scope='manager_only' は「店長にだけ伝えたい」というお客様の選択であり、
   *      本人が直URLで読めるならその選択肢が意味を失う。rating<=2（気づきの声）も
   *      店長が受け止める設計（docs/00_philosophy.md）のため本人には直接見せない。
   *      → SQL 側の .eq/.gte と揃えるため null は不可視に倒す（NULL>=3 は偽）。
   *
   * 弾いた場合は存在を伏せて 404（下の notFound()）。403 とは区別しない。
   */
  const canView =
    !!review &&
    (ctx.role === "manager"
      ? review.staff_id === ctx.staff_id || review.salon_id === ctx.salon_id
      : review.staff_id === ctx.staff_id &&
        review.share_scope === "everyone" &&
        (review.rating ?? 0) >= 3);

  // 「存在しない」と「権限が無い」を **同じ 404** に畳む（not-found.tsx が文言を持つ）。
  // 403 で出し分けると、レビューIDの総当たりで実在を判別できるオラクルになるため区別しない。
  if (!review || !canView) {
    notFound();
  }

  const customer = one(review.customers);
  const fromName = customer?.display_name ?? "お客様";
  const staffId = review.staff_id;
  // サロン全体宛（staff_id null）＝「お店のみんなへ」。個人指標（累計/ランク）は出さない。
  const isSalonWide = staffId === null;

  // お客様が送った評価スタンプ（tier）をスタッフに見せる。amount は取得しない（¥非表示）。
  const { data: purchase } = await supabaseAdmin
    .from("rating_purchases")
    .select("tier")
    .eq("review_id", reviewId)
    .maybeSingle();
  const tierDef = getTier(purchase?.tier);

  // hero は「お客様が送った評価スタンプ（tier）」の絵柄＋tier名のみ。ムード顔文字は hero に出さない。
  // 無償の感想のみ（tierなし）は中立マーク＋「感想が届きました」にフォールバック。
  const heroEmoji = tierDef ? tierDef.emoji : "✉";
  const heroTitle = isSalonWide
    ? "お店に感想が届きました"
    : tierDef
      ? "評価が届きました"
      : "感想が届きました";

  // お客様の「その時の気分」＝絵文字評価（最高/よい/普通/改善）。Review セクション側に添える。
  const mood = REVIEW_RATINGS.find((r) => r.value === review.rating) ?? null;

  // 蓄積（件数のみ・フッター用）。累計=今週 / ランク=通算（仮閾値）。
  const [weekCount, totalCount] = staffId
    ? await Promise.all([
        countEvals(staffId, jstPeriodStartISO("week")),
        countEvals(staffId),
      ])
    : [0, 0];
  const rank = rankForCount(totalCount);

  const tags = (review.tags ?? []).filter(Boolean);

  const displayRole = await resolveSalonRole(ctx);

  return (
    <main className="page page-top" data-role={displayRole}>
      <div className="container stack animate-in">
        <RoleBar role={displayRole} />
        {/* ヘッダー（← 戻る ＋ 中央タイトル ＋ 細罫線） */}
        <div className="staff-topbar">
          <Link href="/staff" className="staff-back" aria-label="戻る">
            ←
          </Link>
          <span className="staff-topbar-title">Received</span>
          <span aria-hidden="true" />
        </div>

        {/* hero（お客様が送った評価スタンプの絵柄のみ。tier名は「あなたへの評価」直下に置く） */}
        <section className="stack-sm center-text">
          <p className="received-mark" aria-hidden="true">
            {heroEmoji}
          </p>
          <Eyebrow className="eyebrow-mint">Your work echoes.</Eyebrow>
          <h1 className="headline">{heroTitle}</h1>
          <p className="muted">from {fromName}様</p>
        </section>

        <hr className="rule" />

        {/* あなたへの評価 → tier名（件数ではなく評価スタンプの種類を主役にする） */}
        <section className="stack-sm center-text">
          <p className="received-count-label">
            {isSalonWide ? "お店のみんなへ" : "あなたへの評価"}
          </p>
          {tierDef ? (
            <p className="received-tier-name">{tierDef.label}</p>
          ) : (
            <p className="received-count">感想</p>
          )}
        </section>

        <hr className="rule" />

        {/* Review（その時の気分＋タグ＋本文カード） */}
        <section className="stack-sm">
          <Eyebrow className="eyebrow-mint">Review</Eyebrow>
          {mood && (
            <div className="mood-row">
              <span className="mood-emoji" aria-hidden="true">
                {mood.emoji}
              </span>
              <span className="mood-label">
                その時の気分・{mood.label}
              </span>
            </div>
          )}
          {tags.length > 0 && (
            <div className="staff-tag-row">
              {tags.map((t) => (
                <span key={t} className="tag-mint">
                  {t}
                </span>
              ))}
            </div>
          )}
          <div className="voice-card">「{review.body}」</div>
        </section>

        <hr className="rule" />

        {/* 累計（今週件数）／ランク。個人指標のためサロン全体宛では丸ごと非表示。
            ランクはさらに RANK_ENABLED のときのみ（件数は出すがランクは伏せる）。 */}
        {!isSalonWide && (
          <div className="received-foot">
            <span>
              <span className="received-foot-label">累計</span>
              <span className="received-foot-value">{weekCount}</span>
            </span>
            {RANK_ENABLED && (
              <span>
                <span className="received-foot-label">ランク</span>
                <span className="received-foot-value">{rank}</span>
              </span>
            )}
          </div>
        )}

        <Link href="/staff" className="btn btn-quiet btn-block">
          ホームへ
        </Link>
      </div>
    </main>
  );
}
