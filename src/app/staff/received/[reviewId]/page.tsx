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
import { staffViewMode, type StaffViewMode } from "@/lib/review-visibility";
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
 *   未ログイン → returnTo付きで LINE ログインへ。表示は3段階（§14 決定1・3 ／ §19 決定2）:
 *   ・manager   : 同サロンの声すべて（従来どおり絞らない）→ **full**
 *   ・staff full: 本人宛て・share_scope='everyone'・rating>=3 → 従来どおり本文まで
 *   ・staff stamp_only: 本人宛ての **full 以外**（manager_only / null / either / 未知の値、
 *       または everyone で rating<=2・null）**かつ有料スタンプあり**
 *       → **お客様の表示名・ティア・その時の気分（rating）**。**本文とタグは出さない**
 *       （§19 決定2 で rating を届けるようにした＝§14 決定3 の「rating も出さない」を上書き）
 *   それ以外は存在を伏せて notFound()＝**HTTP 404**（他人の評価は見せない）。
 *   「存在しない」と「権限が無い」を区別しない（403 を返さない）のは意図的で、
 *   区別するとレビューIDの総当たりで実在を判別できるオラクルになるため。
 *   **「低評価で購入なし」も同じ 404 に畳む**（購入の有無を当てさせない）。
 *
 * 到達導線: /staff の Team voices の各行（自分宛て or 同サロンの manager のみリンク化）と、
 *   /staff の「あなたに届いた声」セクション。リンク可否は下の mode と厳密に一致させる。
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
   * お客様が送った評価スタンプ（tier）。amount は取得しない（¥非表示）。
   *
   * ★可視判定より**前**に引く（§14 決定3）★
   *   rating<=2 の感想は「有料スタンプがあるか」で stamp_only / hidden が分かれるため、
   *   404 を返すかどうかがこの結果に依存する。従来は notFound() の後に引いていた。
   *   review が引けなかったときは無駄なので引かない。
   */
  let hasPurchase = false;
  let purchaseTier: string | null = null;
  if (review) {
    const { data: purchase } = await supabaseAdmin
      .from("rating_purchases")
      .select("tier")
      .eq("review_id", reviewId)
      .maybeSingle();
    hasPurchase = !!purchase;
    purchaseTier = purchase?.tier ?? null;
  }
  const tierDef = getTier(purchaseTier);

  /**
   * 表示モード。ロールで条件が違う。
   *
   *  ・manager: 自分宛て、または同サロンの声すべて（サロン全体宛 staff_id=null を含む）。
   *      店長は /manager/inbox で全件を受け止める役割なので、ここは絞らない＝常に full。
   *  ・staff  : @/lib/review-visibility の staffViewMode に委ねる（3値）。
   *      full       … everyone かつ rating>=3。従来どおり本文まで
   *      stamp_only … full 以外で、その感想に有料スタンプがある。
   *                   本人に見せない本文は店長が口頭で伝える（docs/00_philosophy.md §4.8）
   *                   ので本文とタグは出さないが、**誰からの応援か**と
   *                   **その時の気分（rating）**は本人に届けてよい（§19 決定2）
   *      hidden     … それ以外（full 以外で購入なし / 他人宛て）
   *      判定条件をここに書き写さない（/staff の一覧と食い違うため）。
   *
   * 弾いた場合は存在を伏せて 404（下の notFound()）。403 とは区別しない。
   */
  const mode: StaffViewMode = !review
    ? "hidden"
    : ctx.role === "manager"
      ? review.staff_id === ctx.staff_id || review.salon_id === ctx.salon_id
        ? "full"
        : "hidden"
      : staffViewMode(review, { staffId: ctx.staff_id, hasPurchase });

  // 「存在しない」と「権限が無い」を **同じ 404** に畳む（not-found.tsx が文言を持つ）。
  // 403 で出し分けると、レビューIDの総当たりで実在を判別できるオラクルになるため区別しない。
  // 「低評価で購入なし」もここに畳まれる＝購入の有無を外から当てられない。
  if (!review || mode === "hidden") {
    notFound();
  }

  // stamp_only は「誰からの応援か（ティア）」を届けるためのモード。tier を解決できない
  // （未知の tier 文字列など）ときは主役が残らないので、空の画面を見せずに 404 に倒す。
  // §19 決定2 で気分（rating）も届けるようになったが、**このガードは維持する**
  // ＝気分だけが残っても「誰からの応援か」が伝わらないため（hidden と同じ 404）。
  if (mode === "stamp_only" && !tierDef) {
    notFound();
  }

  /**
   * 名前・ティア・その時の気分（rating）を届けるモード（§14 決定3 → **§19 決定2**）。
   * **本文とタグは出さない**（タグは本文相当の情報とみなす・§19 範囲外）。
   * ⚠️ review.body は select 済みだが **描画しない**。サーバーコンポーネントは
   *   描画された出力しかクライアントへ送らないため、本文はブラウザに渡らない。
   *   ここに本文を足す変更をするときは §14 決定1（本文は店長のみ）に戻ること。
   */
  const isStampOnly = mode === "stamp_only";

  const customer = one(review.customers);
  const fromName = customer?.display_name ?? "お客様";
  const staffId = review.staff_id;
  // サロン全体宛（staff_id null）＝「お店のみんなへ」。個人指標（累計/ランク）は出さない。
  const isSalonWide = staffId === null;

  // hero は「お客様が送った評価スタンプ（tier）」の絵柄＋tier名のみ。ムード顔文字は hero に出さない。
  // 無償の感想のみ（tierなし）は中立マーク＋「感想が届きました」にフォールバック。
  const heroEmoji = tierDef ? tierDef.emoji : "✉";
  const heroTitle = isSalonWide
    ? "お店に感想が届きました"
    : tierDef
      ? "評価が届きました"
      : "感想が届きました";

  // お客様の「その時の気分」＝絵文字評価（最高/よい/普通/改善）。Review セクション側に添える。
  // **stamp_only でも算出する**（§19 決定2。4段階の絵文字は「言葉」ではないので、
  // 本文を届けない感想でも気分までは本人に届ける）。rating が null / 範囲外なら null。
  const mood = REVIEW_RATINGS.find((r) => r.value === review.rating) ?? null;

  // 蓄積（件数のみ・フッター用）。累計=今週 / ランク=通算（仮閾値）。
  const [weekCount, totalCount] = staffId
    ? await Promise.all([
        countEvals(staffId, jstPeriodStartISO("week")),
        countEvals(staffId),
      ])
    : [0, 0];
  const rank = rankForCount(totalCount);

  const tags = isStampOnly ? [] : (review.tags ?? []).filter(Boolean);

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

        {/* Review（その時の気分＋タグ＋本文カード）。**要素ごとに出し分ける**（§19 決定2）。
            ・気分（mood）… full でも stamp_only でも出す
            ・タグと本文  … **!isStampOnly の内側だけ**（本文をこの外へ出さない）
            stamp_only で気分も無い（rating が null / 範囲外）ときは**セクションごと出さない**
            ＝見出しだけの空セクションを作らない。後続の細罫線も同じ条件で一緒に畳むので
            罫線は二重にならない。 */}
        {(!isStampOnly || mood !== null) && (
          <>
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
              {!isStampOnly && (
                <>
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
                </>
              )}
            </section>

            <hr className="rule" />
          </>
        )}

        {/* 累計（今週件数）／ランク。個人指標のためサロン全体宛では丸ごと非表示。
            ランク（A/B/C/D）はさらに RANK_ENABLED のときのみ＝現在は常に非表示。
            ⚠️ この RANK_ENABLED は**ティア（👍☕🍰💐👑）とは無関係**。ティアは上の
            hero と「あなたへの評価」で無条件に表示している（→ docs/40_decisions.md §4.5）。 */}
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
