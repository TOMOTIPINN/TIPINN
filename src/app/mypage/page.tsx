import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Eyebrow, Card, StampRing, VipBadge } from "@/components/ui";
import { LogoCircle } from "@/components/LogoCircle";
import CheckInCard from "@/components/CheckInCard";
import { CYCLE_SIZE, computeVipProgress } from "@/lib/vip";
import { computeVisitProgress } from "@/lib/visit";
import { getSalonRewardsMap } from "@/lib/rewards";
import { getTier } from "@/lib/rating-tiers";

/**
 * マイページ（画面マップ10・白世界）。
 * 顧客が自分の貯めたスタンプをサロンごとに確認する画面。サーバーコンポーネント。
 *
 * 対象サロン = 感想軸(earned_stamps) ∪ 来店軸(visits) の和集合（来店だけのサロンもカード化）。
 * カードは軸ごとに独立セクション:
 *   ・感想セクション = earned_stamps 行があるとき（StampRing・CYCLE_SIZE=3固定・@/lib/vip）
 *   ・来店セクション = salons.visit_axis_enabled=true のとき（ドットゲージ・可変 visit_cycle_size・@/lib/visit）
 *   ・特典(rewards)は両軸共通なのでカードに1回だけ（title のみ・金額/割引率は出さない）
 * カードを出す条件 = hasReview || visit_axis_enabled（来店のみ&axis OFF は空カードになるので出さない）。
 * 個人情報は service role でサーバー側のみ。
 */
type ReviewRow = { salon_id: string; count: number | null; updated_at: string };
type VisitRow = { salon_id: string; created_at: string };
// 送った評価の履歴（Your echoes sent）。FK埋め込みでスタッフ名・サロン名も同時取得。
// amount は案B（金額ゼロ）のため取得も表示もしない。staff は退職時 null になり得る。
type SentEchoRow = {
  created_at: string;
  tier: string;
  staff: { name: string } | null;
  salon: { name: string; logo_url: string | null } | null;
};

// 履歴の日付表示（JST・既存の staff/page と同じ Intl パターンを流用。履歴なので年も添える）。
const jstDate = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "numeric",
  day: "numeric",
});
type SalonMeta = {
  id: string;
  name: string;
  logo_url: string | null;
  logo_pos_x: number;
  logo_pos_y: number;
  logo_zoom: number;
  visit_axis_enabled: boolean;
  visit_cycle_size: number;
};

export default async function MyPage() {
  const session = await getSession();
  if (!session) {
    redirect("/api/auth/line/login");
  }

  // 表示名ゲート（初回チェックイン直前・[[auth-method-line-b]]）: name_confirmed_at 未設定なら
  //   /onboarding/name で名前を確定させてから戻す（チェックインQRを見せる手前に1画面挟む）。
  const { data: gate } = await supabaseAdmin
    .from("customers")
    .select("name_confirmed_at")
    .eq("id", session.customer_id)
    .single();
  if (!gate?.name_confirmed_at) {
    redirect(`/onboarding/name?returnTo=${encodeURIComponent("/mypage")}`);
  }

  // 第1波: 顧客 / 感想軸カウント / 来店行（来店行は1日1行なのでJSでsalonごとにCOUNT集計）
  //        / 送った評価の履歴（既存3クエリとは独立・時系列 desc・FK埋め込みで名前も同時取得）。
  const [{ data: customer }, { data: reviews }, { data: visits }, { data: sent }] =
    await Promise.all([
      supabaseAdmin
        .from("customers")
        .select("display_name")
        .eq("id", session.customer_id)
        .single(),
      supabaseAdmin
        .from("earned_stamps")
        .select("salon_id, count, updated_at")
        .eq("customer_id", session.customer_id)
        .order("updated_at", { ascending: false }),
      supabaseAdmin
        .from("visits")
        .select("salon_id, created_at")
        .eq("customer_id", session.customer_id),
      supabaseAdmin
        .from("rating_purchases")
        .select("created_at, tier, staff:staff(name), salon:salons(name, logo_url)")
        .eq("customer_id", session.customer_id)
        .order("created_at", { ascending: false }),
    ]);

  const reviewRows = (reviews ?? []) as ReviewRow[];
  const visitRows = (visits ?? []) as VisitRow[];
  const sentEchoes = (sent ?? []) as unknown as SentEchoRow[];

  const reviewMap = new Map<string, ReviewRow>();
  for (const r of reviewRows) reviewMap.set(r.salon_id, r);

  // 累計来店回数（表示・進捗用）と、最終来店日時 MAX(created_at)（並び順用）を同じ1パスで集計。
  const visitCountMap = new Map<string, number>();
  const lastVisitMap = new Map<string, string>();
  for (const v of visitRows) {
    visitCountMap.set(v.salon_id, (visitCountMap.get(v.salon_id) ?? 0) + 1);
    const prev = lastVisitMap.get(v.salon_id);
    if (!prev || new Date(v.created_at) > new Date(prev)) {
      lastVisitMap.set(v.salon_id, v.created_at);
    }
  }

  // 和集合の並び（最終来店 MAX(created_at) 基準）:
  //   ・来店あり(lastVisit あり)を上、未来店(visit=0)を下。
  //   ・来店ありグループ内は最終来店の降順（今日来店した店が最上部）。
  //   ・同着 or 未来店グループは既存シグナル earned_stamps.updated_at の降順で安定化。
  // 候補は感想(earned_stamps)∪来店(visits) の和集合。挿入順(感想→来店)が sort 安定時の最終フォールバック。
  const candidateIds = new Set<string>([
    ...reviewRows.map((r) => r.salon_id),
    ...visitRows.map((v) => v.salon_id),
  ]);
  const orderedIds = [...candidateIds].sort((a, b) => {
    const va = lastVisitMap.get(a);
    const vb = lastVisitMap.get(b);
    // 来店ありを未来店より上に。
    if (va && !vb) return -1;
    if (!va && vb) return 1;
    if (va && vb) {
      const d = new Date(vb).getTime() - new Date(va).getTime();
      if (d !== 0) return d; // 最終来店の降順
    }
    // 同着（同時刻来店）または両方未来店: 直近レビューの降順で安定化。
    const ra = reviewMap.get(a)?.updated_at;
    const rb = reviewMap.get(b)?.updated_at;
    if (ra && rb) return new Date(rb).getTime() - new Date(ra).getTime();
    if (ra && !rb) return -1;
    if (!ra && rb) return 1;
    return 0;
  });

  // 第2波: 和集合IDのサロンメタ(来店列込み) と rewards を一括取得（N+1回避）。
  const [{ data: salonData }, rewardsMap] = await Promise.all([
    orderedIds.length
      ? supabaseAdmin
          .from("salons")
          .select(
            "id, name, logo_url, logo_pos_x, logo_pos_y, logo_zoom, visit_axis_enabled, visit_cycle_size",
          )
          .in("id", orderedIds)
      : Promise.resolve({ data: [] as SalonMeta[] }),
    getSalonRewardsMap(orderedIds),
  ]);

  const salonMeta = new Map<string, SalonMeta>();
  for (const s of (salonData ?? []) as SalonMeta[]) salonMeta.set(s.id, s);

  // 表示対象 = hasReview || axis ON。来店のみ&axis OFF は除外（空カード回避）。
  const shownIds = orderedIds.filter((id) => {
    const meta = salonMeta.get(id);
    if (!meta) return false;
    return reviewMap.has(id) || meta.visit_axis_enabled === true;
  });

  const displayName = customer?.display_name || "ゲスト";

  // チェックイン用QR（提示専用）。中身は今は customer_id 素のまま。
  // ★本番: なりすまし防止のため署名付き短命トークンに差し替える（TODO）。
  // 生成はサーバー側ローカルのみ（外部送信なし・原則7。招待QRと同じ作法）。
  const checkInQr = await QRCode.toDataURL(session.customer_id, {
    margin: 1,
    width: 240,
  });

  return (
    <main className="page page-top">
      <div className="container stack animate-in">
        <header className="stack-sm">
          <Eyebrow>MY echo</Eyebrow>
          <h1 className="headline">{displayName}</h1>
          <Link
            href="/onboarding/name?edit=1&returnTo=%2Fmypage"
            className="btn btn-quiet name-edit-link"
          >
            お名前を変更
          </Link>
        </header>

        <hr className="rule" />

        <CheckInCard qrDataUrl={checkInQr} />

        <section className="stack">
          <Eyebrow>Your stamps</Eyebrow>

          {shownIds.length === 0 ? (
            <Card>
              <p className="muted center-text">
                まだスタンプがありません。
                <br />
                感想を送ると、サロンごとにスタンプが貯まります。
              </p>
            </Card>
          ) : (
            shownIds.map((id) => {
              const meta = salonMeta.get(id)!;
              const logo = meta.logo_url ?? null;
              const initials = (meta.name ?? "").slice(0, 3);
              const rewards = rewardsMap.get(id) ?? [];

              // 感想軸（earned_stamps 行があるときのみ）。
              const hasReview = reviewMap.has(id);
              const reviewCount = reviewMap.get(id)?.count ?? 0;
              const vip = hasReview
                ? computeVipProgress(reviewCount, rewards)
                : null;

              // 来店軸（visit_axis_enabled のときのみ）。
              const axisOn = meta.visit_axis_enabled === true;
              const visit = axisOn
                ? computeVisitProgress(
                    visitCountMap.get(id) ?? 0,
                    meta.visit_cycle_size,
                  )
                : null;

              return (
                <Card key={id}>
                  <div className="stack stack-md">
                    <div className="salon-head">
                      <span className="salon-logo" aria-hidden="true">
                        <LogoCircle
                          logoUrl={logo}
                          x={meta.logo_pos_x}
                          y={meta.logo_pos_y}
                          zoom={meta.logo_zoom}
                          fallback={initials}
                        />
                      </span>
                      <span className="headline-sm">{meta.name}</span>
                      {vip?.isVIP && <VipBadge />}
                      {vip && (
                        <span className="salon-count">
                          {vip.progressInCycle} / {CYCLE_SIZE}
                        </span>
                      )}
                    </div>

                    {/* 感想セクション */}
                    {vip && (
                      <>
                        <StampRing
                          count={vip.progressInCycle}
                          size={CYCLE_SIZE}
                          logoUrl={logo}
                          fallback={initials}
                          logoX={meta.logo_pos_x}
                          logoY={meta.logo_pos_y}
                          logoZoom={meta.logo_zoom}
                        />
                        <p className="muted">
                          次の特典まであと {vip.toNextPerk} 個
                          {vip.cyclesCompleted > 0 &&
                            `（特典 ${vip.cyclesCompleted} 回獲得・累計 ${reviewCount} 個）`}
                        </p>
                      </>
                    )}

                    {/* 来店セクション（感想3マスとは視覚分離・ドットゲージ・ミント） */}
                    {visit && (
                      <div className="stack stack-sm">
                        <Eyebrow>Visits</Eyebrow>
                        <div
                          className="visit-gauge"
                          role="img"
                          aria-label={`来店 ${visit.progressInCycle} / ${visit.cycleSize}`}
                        >
                          {Array.from({ length: visit.cycleSize }).map((_, i) => (
                            <span
                              key={i}
                              className={`visit-dot${i < visit.progressInCycle ? " is-on" : ""}`}
                            />
                          ))}
                        </div>
                        <p className="muted">
                          {rewards.length > 0
                            ? `あと ${visit.toNextPerk} 回で来店特典`
                            : `あと ${visit.toNextPerk} 回`}
                        </p>
                        <p className="visit-meta">累計来店 {visit.count} 回</p>
                      </div>
                    )}

                    {/* 特典（両軸共通・title のみ・金額/割引率は出さない）。0件なら出さない。 */}
                    {rewards.length > 0 && (
                      <div className="stack stack-sm">
                        <p className="perk-head">もらえる特典</p>
                        <ul className="perk-list">
                          {rewards.map((reward) => (
                            <li key={reward.id} className="perk-item">
                              {reward.title}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </Card>
              );
            })
          )}
        </section>

        {/* 送った評価の履歴（案B：金額ゼロ）。件数0でもセクションは残し、機能の存在を伝える。
            ティア絵文字/ラベル＋スタッフ名＋日付のみ。金額・合計は一切出さない（原則5）。 */}
        <section className="stack">
          <Eyebrow>Your echoes sent</Eyebrow>

          {sentEchoes.length === 0 ? (
            <Card>
              <p className="muted center-text">
                まだ送った評価はありません。
                <br />
                気持ちが動いたとき、評価スタンプで感謝を届けられます。
              </p>
            </Card>
          ) : (
            <Card>
              <ul className="echo-sent-list">
                {sentEchoes.map((row, i) => {
                  const tier = getTier(row.tier);
                  // staff_id が null（退職＝on delete set null）でも壊れないようフォールバック。
                  const staffName = row.staff?.name ?? "(退職スタッフ)";
                  return (
                    <li key={i} className="echo-sent-item">
                      <span className="tier-emoji" aria-hidden="true">
                        {tier?.emoji ?? "✎"}
                      </span>
                      <span className="echo-sent-main">
                        <span className="tier-label">
                          {tier?.label ?? row.tier}
                        </span>
                        <span className="echo-sent-sub">
                          {staffName}さん
                          {row.salon?.name ? `・${row.salon.name}` : ""}
                        </span>
                      </span>
                      <span className="echo-sent-date">
                        {jstDate.format(new Date(row.created_at))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </section>

        <Link href="/" className="btn btn-quiet btn-block">
          ホームへ
        </Link>
      </div>
    </main>
  );
}
