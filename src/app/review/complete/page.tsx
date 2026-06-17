import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Eyebrow, StampRing } from "@/components/ui";

/**
 * 感想 送信完了画面（画面マップ06・白世界）。
 * フォームには戻さない専用画面。再送ループは作らない（導線はマイページ/ホームのみ）。
 * - stamp_awarded=true  → 「スタンプが1つ貯まりました（合計N個）」＋ 円スタンプ点灯
 * - stamp_awarded=false → 「感想ありがとうございました」＋ 1日1個の説明
 * 合計数は query ではなく earned_stamps から再取得（authoritative）。
 * awarded は今回の送信で付与されたかの一回性フラグなので query で受ける。
 */
export default async function ReviewCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ salon?: string; awarded?: string }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/api/auth/line/login");
  }

  const { salon: salonId, awarded } = await searchParams;
  if (!salonId) {
    redirect("/");
  }
  const stampAwarded = awarded === "1";

  const [{ data: salon }, { data: stamp }, { data: reward }] = await Promise.all(
    [
      supabaseAdmin.from("salons").select("name, logo_url").eq("id", salonId).single(),
      supabaseAdmin
        .from("earned_stamps")
        .select("count")
        .eq("customer_id", session.customer_id)
        .eq("salon_id", salonId)
        .maybeSingle(),
      supabaseAdmin
        .from("rewards")
        .select("required_count, title")
        .eq("salon_id", salonId)
        .order("required_count", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ],
  );

  const count = stamp?.count ?? 0;
  const ringSize = reward?.required_count ?? 5;
  const remainingToReward = reward ? Math.max(reward.required_count - count, 0) : 0;
  const logo = salon?.logo_url ?? null;
  const initials = (salon?.name ?? "").slice(0, 4);

  return (
    <main className="page">
      <div className="container stack center-text animate-in">
        <header className="stack-sm center-text">
          <Eyebrow>Thank you</Eyebrow>
          <h1 className="headline">
            {stampAwarded ? "ありがとうございました" : "感想ありがとうございました"}
          </h1>
        </header>

        <StampRing count={count} size={ringSize} logoUrl={logo} fallback={initials} />

        {stampAwarded ? (
          <p className="body">スタンプが1つ貯まりました（合計 {count}個）</p>
        ) : (
          <p className="body">
            スタンプは1日1個。今日はもう貯まっています。
          </p>
        )}

        {reward && remainingToReward > 0 && (
          <p className="muted">
            あと {remainingToReward} 個で「{reward.title}」
          </p>
        )}

        <div className="stack stack-sm">
          <a href="/mypage" className="btn btn-outline btn-block">
            マイページで確認する
          </a>
          <a href="/" className="btn btn-quiet btn-block">
            ホームへ
          </a>
        </div>
      </div>
    </main>
  );
}
