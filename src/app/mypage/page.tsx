import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Eyebrow, Card, StampRing, VipBadge } from "@/components/ui";
import { LogoCircle } from "@/components/LogoCircle";
import { CYCLE_SIZE, computeVipProgress } from "@/lib/vip";
import { computeVisitProgress } from "@/lib/visit";
import { getSalonRewardsMap } from "@/lib/rewards";

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
type VisitRow = { salon_id: string };
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

  // 第1波: 顧客 / 感想軸カウント / 来店行（来店行は1日1行なのでJSでsalonごとにCOUNT集計）。
  const [{ data: customer }, { data: reviews }, { data: visits }] =
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
        .select("salon_id")
        .eq("customer_id", session.customer_id),
    ]);

  const reviewRows = (reviews ?? []) as ReviewRow[];
  const visitRows = (visits ?? []) as VisitRow[];

  const reviewMap = new Map<string, ReviewRow>();
  for (const r of reviewRows) reviewMap.set(r.salon_id, r);

  const visitCountMap = new Map<string, number>();
  for (const v of visitRows) {
    visitCountMap.set(v.salon_id, (visitCountMap.get(v.salon_id) ?? 0) + 1);
  }

  // 和集合の並び: 感想軸サロン(updated_at desc) → 来店のみサロン(累計来店 desc)。
  const orderedIds: string[] = [];
  const seen = new Set<string>();
  for (const r of reviewRows) {
    if (!seen.has(r.salon_id)) {
      seen.add(r.salon_id);
      orderedIds.push(r.salon_id);
    }
  }
  for (const [id] of [...visitCountMap.entries()]
    .filter(([id]) => !seen.has(id))
    .sort((a, b) => b[1] - a[1])) {
    orderedIds.push(id);
  }

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

  return (
    <main className="page page-top">
      <div className="container stack animate-in">
        <header className="stack-sm">
          <Eyebrow>MY echo</Eyebrow>
          <h1 className="headline">{displayName}</h1>
        </header>

        <hr className="rule" />

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

        <Link href="/" className="btn btn-quiet btn-block">
          ホームへ
        </Link>
      </div>
    </main>
  );
}
