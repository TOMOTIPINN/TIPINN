import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Eyebrow, StampRing, VipBadge } from "@/components/ui";
import { CYCLE_SIZE, computeVipProgress } from "@/lib/vip";

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
  searchParams: Promise<{ salon?: string; staff?: string; awarded?: string }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/api/auth/line/login");
  }

  const { salon: salonId, staff: staffId, awarded } = await searchParams;
  if (!salonId) {
    redirect("/");
  }
  const stampAwarded = awarded === "1";

  const [{ data: salon }, { data: stamp }, { data: staff }] = await Promise.all([
    supabaseAdmin.from("salons").select("name, logo_url").eq("id", salonId).single(),
    supabaseAdmin
      .from("earned_stamps")
      .select("count")
      .eq("customer_id", session.customer_id)
      .eq("salon_id", salonId)
      .maybeSingle(),
    // 評価スタンプ導線のためスタッフ名を温かく出す（対象が指定されている時だけ）。
    staffId
      ? supabaseAdmin
          .from("staff")
          .select("name")
          .eq("id", staffId)
          .eq("salon_id", salonId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const count = stamp?.count ?? 0;
  // 無料感想スタンプは「循環型」進捗（CYCLE_SIZE個ごとに特典発動）。@/lib/vip に集約。
  const vip = computeVipProgress(count);
  // 今回の送信でちょうど1サイクル満了＝特典が発動したか。
  const perkJustFired = stampAwarded && vip.isVIP && vip.progressInCycle === 0;
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

        <StampRing
          count={vip.progressInCycle}
          size={CYCLE_SIZE}
          logoUrl={logo}
          fallback={initials}
        />

        {vip.isVIP && <VipBadge />}

        {stampAwarded ? (
          <p className="body">スタンプが1つ貯まりました（合計 {count}個）</p>
        ) : (
          <p className="muted">スタンプはご来店時にひとつまでです。</p>
        )}

        {perkJustFired ? (
          <p className="body">VIP特典が発動しました。次のサイクルがはじまります。</p>
        ) : (
          <p className="muted">
            次の特典まであと {vip.toNextPerk} 個（{vip.progressInCycle} / {CYCLE_SIZE}）
          </p>
        )}

        {staffId && staff && (
          <div className="stack stack-sm">
            <Eyebrow>Send your thanks</Eyebrow>
            <p className="muted">
              今日の体験を{staff.name}さんに評価スタンプで送れます。
            </p>
            <a
              href={`/rating?salon=${encodeURIComponent(salonId)}&staff=${encodeURIComponent(staffId)}`}
              className="btn btn-subtle btn-block"
            >
              評価スタンプを送る
            </a>
          </div>
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
