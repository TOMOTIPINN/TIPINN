import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Eyebrow, Card, StampRing, VipBadge } from "@/components/ui";
import { CYCLE_SIZE, computeVipProgress } from "@/lib/vip";

/**
 * マイページ（画面マップ10・白世界）。
 * 顧客が自分の貯めたスタンプをサロンごとに確認する画面。
 * サーバーコンポーネント。getSession() で customer_id を取得し、未ログインはログインへ。
 * earned_stamps を salons と結合してサロンごとに1カード。
 * 無料感想スタンプは「循環型」進捗（CYCLE_SIZE個ごとに特典発動）。判定は @/lib/vip に集約。
 * 個人情報は service role でサーバー側のみ。
 */
type StampRow = {
  salon_id: string;
  count: number | null;
  salons:
    | { name: string; logo_url: string | null }
    | { name: string; logo_url: string | null }[]
    | null;
};

export default async function MyPage() {
  const session = await getSession();
  if (!session) {
    redirect("/api/auth/line/login");
  }

  const [{ data: customer }, { data: stamps }] = await Promise.all([
    supabaseAdmin
      .from("customers")
      .select("display_name")
      .eq("id", session.customer_id)
      .single(),
    supabaseAdmin
      .from("earned_stamps")
      .select("salon_id, count, salons(name, logo_url)")
      .eq("customer_id", session.customer_id)
      .order("updated_at", { ascending: false }),
  ]);

  const stampRows = (stamps ?? []) as StampRow[];

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

          {stampRows.length === 0 ? (
            <Card>
              <p className="muted center-text">
                まだスタンプがありません。
                <br />
                感想を送ると、サロンごとにスタンプが貯まります。
              </p>
            </Card>
          ) : (
            stampRows.map((row) => {
              const salon = Array.isArray(row.salons) ? row.salons[0] : row.salons;
              if (!salon) return null;

              const count = row.count ?? 0;
              // 無料感想スタンプの循環型進捗（CYCLE_SIZE個ごとに特典発動）。@/lib/vip に集約。
              const vip = computeVipProgress(count);
              const logo = salon.logo_url ?? null;
              const initials = (salon.name ?? "").slice(0, 3);

              return (
                <Card key={row.salon_id}>
                  <div className="stack stack-md">
                    <div className="salon-head">
                      <span className="salon-logo" aria-hidden="true">
                        {logo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={logo} alt="" />
                        ) : (
                          initials
                        )}
                      </span>
                      <span className="headline-sm">{salon.name}</span>
                      {vip.isVIP && <VipBadge />}
                      <span className="salon-count">
                        {vip.progressInCycle} / {CYCLE_SIZE}
                      </span>
                    </div>

                    <StampRing
                      count={vip.progressInCycle}
                      size={CYCLE_SIZE}
                      logoUrl={logo}
                      fallback={initials}
                    />

                    <p className="muted">
                      次の特典まであと {vip.toNextPerk} 個
                      {vip.cyclesCompleted > 0 &&
                        `（特典 ${vip.cyclesCompleted} 回獲得・累計 ${count} 個）`}
                    </p>
                  </div>
                </Card>
              );
            })
          )}
        </section>

        <a href="/" className="btn btn-quiet btn-block">
          ホームへ
        </a>
      </div>
    </main>
  );
}
