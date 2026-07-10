import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";
import { Eyebrow, Card } from "@/components/ui";
import RoleBar from "@/components/RoleBar";
import { resolveSalonRole } from "@/lib/display-role";
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
 * 蓄積（件数）＋ Team voices を表示する。トーン: 暖色＋ミント・ゴシック・**¥なし**（§2/§4）。
 *   集計は staff_id 軸（感想＋有料評価の件数のみ）。金額列は select しない。
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
  staff: { name: string } | { name: string }[] | null;
};

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
          <div className="metric-card">
            <p className="metric-value">{reviews[row.key]}件</p>
          </div>
          {stamps && (
            <div className="metric-card">
              <p className="metric-value">{stamps[row.key]}件</p>
            </div>
          )}
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

export default async function StaffHomePage() {
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

  // 感想（reviews）: あなたへ／お店への各グループ×今週/今月/今期 ＋ Team voices。
  const [youRvW, youRvM, youRvQ, shopRvW, shopRvM, shopRvQ, voicesRes] =
    await Promise.all([
      countRows("reviews", youScope, weekStart),
      countRows("reviews", youScope, monthStart),
      countRows("reviews", youScope, quarterStart),
      countRows("reviews", salonScope, weekStart),
      countRows("reviews", salonScope, monthStart),
      countRows("reviews", salonScope, quarterStart),
      // Team voices: 同サロンの新着感想（店長のみ宛＝manager_only は除外）。
      supabaseAdmin
        .from("reviews")
        .select("id, body, rating, created_at, share_scope, staff(name)")
        .eq("salon_id", ctx.salon_id)
        .neq("share_scope", "manager_only")
        .order("created_at", { ascending: false })
        .limit(5),
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

  // ランクは RANK_ENABLED のときだけ（PAID_STAMPS_ENABLED とは独立）。あなたへ通算（感想＋評価スタンプ）基準。
  let rank: "A" | "B" | "C" | "D" | null = null;
  if (RANK_ENABLED) {
    const [youRvTotal, youPvTotal] = await Promise.all([
      countRows("reviews", youScope),
      countRows("rating_purchases", youScope),
    ]);
    rank = rankForCount(youRvTotal + youPvTotal);
  }

  const voices = (voicesRes.data ?? []) as VoiceRow[];

  const greeting = GREETING_LABEL[jstGreeting()];

  const displayRole = await resolveSalonRole(ctx);

  return (
    <main className="page page-top" data-role={displayRole}>
      <div className="container stack animate-in">
        <RoleBar role={displayRole} />
        <header className="stack-sm">
          <Eyebrow className="eyebrow-mint">{greeting}</Eyebrow>
          <h1 className="headline">{ctx.name} さん</h1>
        </header>

        <hr className="rule" />

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
                  return (
                    <div key={v.id} className="team-voice">
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
      </div>
    </main>
  );
}
