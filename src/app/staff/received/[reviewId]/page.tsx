import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";
import { Eyebrow } from "@/components/ui";
import RoleBar from "@/components/RoleBar";
import { resolveSalonRole } from "@/lib/display-role";
import { getTier } from "@/lib/rating-tiers";
import { REVIEW_RATINGS } from "@/lib/review";
import { jstPeriodStartISO, rankForCount } from "@/lib/staff-stats";

/**
 * 13 スタッフ通知（画面マップ13・確定UI＝デッキ v6 P8）。
 * 評価/感想の着信を1件表示する。ルート: /staff/received/[reviewId]
 *
 * 構造（デッキP8厳守・docs/phase5b_staff_screens.md §6）:
 *   ヘッダー → hero（Your work echoes./評価が届きました/from 〇〇様）
 *   → あなたへの評価 ＋N件 → Review（タグ＋本文カード）→ 累計／ランク
 *
 * トーン: サロンUI世界（暖色＋ミント）。ゴシック・明朝不可・細罫線・**¥は一切表示しない**。
 *   金額列（rating_purchases.amount）は **select しない**（¥がスタッフ画面に漏れないことを構造で担保・§2/§4）。
 *
 * 認証（方式B / [[auth-method-line-b]]）: ログイン中の LINE から getStaffContext() を解決。
 *   未ログイン → returnTo付きで LINE ログインへ。閲覧できるのは
 *   「本人宛の評価（review.staff_id===自分）」または「同サロンの店長（manager）」のみ。
 *   それ以外は存在を伏せて not-found 扱い（他人の評価は見せない）。
 */

type ReviewRow = {
  id: string;
  body: string;
  tags: string[] | null;
  rating: number | null;
  created_at: string;
  staff_id: string | null;
  salon_id: string;
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
  const [r, p] = await Promise.all([head("reviews"), head("rating_purchases")]);
  return (r.count ?? 0) + (p.count ?? 0);
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
      "id, body, tags, rating, created_at, staff_id, salon_id, customers(display_name)",
    )
    .eq("id", reviewId)
    .single();

  const review = data as ReviewRow | null;

  // 本人宛、または同サロンの店長のみ閲覧可。それ以外は存在を伏せる（not-found 扱い）。
  const canView =
    !!review &&
    (review.staff_id === ctx.staff_id ||
      (ctx.role === "manager" && review.salon_id === ctx.salon_id));

  if (!review || !canView) {
    return (
      <main className="page">
        <p className="muted center-text">この評価は見つかりませんでした。</p>
      </main>
    );
  }

  const customer = one(review.customers);
  const fromName = customer?.display_name ?? "お客様";
  const staffId = review.staff_id;

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
  const heroTitle = tierDef ? "評価が届きました" : "感想が届きました";

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
          <p className="received-count-label">あなたへの評価</p>
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

        {/* 累計（今週件数）／ランク */}
        <div className="received-foot">
          <span>
            <span className="received-foot-label">累計</span>
            <span className="received-foot-value">{weekCount}</span>
          </span>
          <span>
            <span className="received-foot-label">ランク</span>
            <span className="received-foot-value">{rank}</span>
          </span>
        </div>

        <Link href="/staff" className="btn btn-quiet btn-block">
          ホームへ
        </Link>
      </div>
    </main>
  );
}
