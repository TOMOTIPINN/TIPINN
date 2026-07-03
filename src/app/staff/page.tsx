import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";
import { Eyebrow, Card } from "@/components/ui";
import {
  GREETING_LABEL,
  jstGreeting,
  jstPeriodStartISO,
  rankForCount,
  signed,
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

/** staff_id 軸の評価件数（感想＋有料評価・件数のみ）。[since, until) の半開区間で絞れる。 */
async function countEvals(
  staffId: string,
  sinceISO?: string,
  untilISO?: string,
): Promise<number> {
  const head = (table: "reviews" | "rating_purchases") => {
    let q = supabaseAdmin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("staff_id", staffId);
    if (sinceISO) q = q.gte("created_at", sinceISO);
    if (untilISO) q = q.lt("created_at", untilISO);
    return q;
  };
  const [r, p] = await Promise.all([head("reviews"), head("rating_purchases")]);
  return (r.count ?? 0) + (p.count ?? 0);
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
  // 先週＝今週開始の7日前〜今週開始の半開区間。
  const prevWeekStart = new Date(
    new Date(weekStart).getTime() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [thisWeek, lastWeek, thisMonth, thisQuarter, total, voicesRes] =
    await Promise.all([
      countEvals(ctx.staff_id, weekStart),
      countEvals(ctx.staff_id, prevWeekStart, weekStart),
      countEvals(ctx.staff_id, monthStart),
      countEvals(ctx.staff_id, quarterStart),
      countEvals(ctx.staff_id),
      // Team voices: 同サロンの新着感想（店長のみ宛＝manager_only は除外）。
      supabaseAdmin
        .from("reviews")
        .select("id, body, rating, created_at, share_scope, staff(name)")
        .eq("salon_id", ctx.salon_id)
        .neq("share_scope", "manager_only")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  const rank = rankForCount(total);
  const weekDelta = thisWeek - lastWeek;
  const voices = (voicesRes.data ?? []) as VoiceRow[];

  const greeting = GREETING_LABEL[jstGreeting()];

  return (
    <main className="page page-top">
      <div className="container stack animate-in">
        <header className="stack-sm">
          <Eyebrow className="eyebrow-mint">{greeting}</Eyebrow>
          <h1 className="headline">{ctx.name} さん</h1>
        </header>

        <hr className="rule" />

        {/* 店頭の来店受付（お客様QRを読み取って来店記録）。日々の主動線なので上部に置く。 */}
        <Link href="/staff/visit" className="btn btn-outline btn-block">
          来店受付（QRを読み取る）
        </Link>

        {/* Your appreciation（件数のみ・¥なし） */}
        <section className="stack-md">
          <div className="dash-head">
            <Eyebrow className="eyebrow-mint">Your appreciation</Eyebrow>
            <span className="role-tag">ランク {rank}</span>
          </div>
          <div className="metric-grid">
            <div className="metric-card">
              <p className="metric-label">今週</p>
              <p className="metric-value">{thisWeek}件</p>
              <p className="metric-delta">
                先週比{" "}
                <span className={weekDelta > 0 ? "trend-up" : undefined}>
                  {signed(weekDelta)}
                </span>
              </p>
            </div>
            <div className="metric-card">
              <p className="metric-label">今月</p>
              <p className="metric-value">{thisMonth}件</p>
            </div>
            <div className="metric-card">
              <p className="metric-label">今期</p>
              <p className="metric-value">{thisQuarter}件</p>
            </div>
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

        <Link href="/" className="btn btn-quiet btn-block">
          ホームへ
        </Link>
      </div>
    </main>
  );
}
