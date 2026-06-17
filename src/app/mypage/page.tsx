import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Eyebrow, Card, StampRing } from "@/components/ui";

/**
 * マイページ（画面マップ10・白世界）。
 * 顧客が自分の貯めたスタンプをサロンごとに確認する画面。
 * サーバーコンポーネント。getSession() で customer_id を取得し、未ログインはログインへ。
 * earned_stamps を salons と結合してサロンごとに1カード。rewards があれば次の特典まで表示。
 * rewards 未設定でも壊れないようフォールバックする。個人情報は service role でサーバー側のみ。
 */
type StampRow = {
  salon_id: string;
  count: number | null;
  salons:
    | { name: string; logo_url: string | null }
    | { name: string; logo_url: string | null }[]
    | null;
};

type Reward = { salon_id: string; required_count: number; title: string };

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

  // サロンごとの rewards をまとめて取得（required_count 昇順 / 未設定でも空で問題なし）
  const rewardsBySalon = new Map<string, { required_count: number; title: string }[]>();
  const salonIds = stampRows.map((s) => s.salon_id);
  if (salonIds.length) {
    const { data: rewards } = await supabaseAdmin
      .from("rewards")
      .select("salon_id, required_count, title")
      .in("salon_id", salonIds)
      .order("required_count", { ascending: true });
    for (const r of (rewards ?? []) as Reward[]) {
      const arr = rewardsBySalon.get(r.salon_id) ?? [];
      arr.push({ required_count: r.required_count, title: r.title });
      rewardsBySalon.set(r.salon_id, arr);
    }
  }

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
              const rewards = rewardsBySalon.get(row.salon_id) ?? [];
              const nextReward = rewards.find((r) => r.required_count > count);
              const ringSize =
                nextReward?.required_count ??
                (rewards.length
                  ? rewards[rewards.length - 1].required_count
                  : Math.max(count, 5));
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
                      <span className="salon-count">
                        {count} / {ringSize}
                      </span>
                    </div>

                    <StampRing
                      count={count}
                      size={ringSize}
                      logoUrl={logo}
                      fallback={initials}
                    />

                    {nextReward ? (
                      <p className="muted">
                        あと {nextReward.required_count - count} 個で「
                        {nextReward.title}」
                      </p>
                    ) : rewards.length ? (
                      <p className="muted">特典を獲得しました（{count}個）</p>
                    ) : (
                      <p className="muted">スタンプ {count}個</p>
                    )}
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
