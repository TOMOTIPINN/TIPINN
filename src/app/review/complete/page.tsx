import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Eyebrow, StampRing, VipBadge } from "@/components/ui";
import { CYCLE_SIZE, computeVipProgress } from "@/lib/vip";
import { getSalonRewards } from "@/lib/rewards";
import { loadReviewForPurchase } from "@/lib/review-server";
import { isPurchasableReview } from "@/lib/review-purchase";

/**
 * 感想 送信完了画面（画面マップ06・白世界）。
 * フォームには戻さない専用画面。再送ループは作らない（導線はマイページ/ホームのみ）。
 * - stamp_awarded=true  → 「スタンプが1つ貯まりました（合計N個）」＋ 円スタンプ点灯
 * - stamp_awarded=false → 「感想ありがとうございました」＋ 1日1個の説明
 * 合計数は query ではなく earned_stamps から再取得（authoritative）。
 * awarded は今回の送信で付与されたかの一回性フラグなので query で受ける。
 *
 * 「評価スタンプを送る」リンク（§13 ステップ3）:
 *   ?review=<uuid> の感想が **購入可能な感想**（本人の・このサロンの・このスタッフ宛ての・
 *   share_scope='everyone'）のときだけ出す。**rating は見ない**（§14）ので、
 *   「改善」「普通」を選んだ直後の完了画面にもこのリンクは出る（意図どおり）。
 *   判定は @/lib/review-purchase の
 *   isPurchasableReview（/api/checkout と同じ関数）。満たさない／review が無い／引けない場合は
 *   **リンクを出さないだけ**で、エラー画面にはしない（完了画面の他の表示は従来どおり）。
 */
export default async function ReviewCompletePage({
  searchParams,
}: {
  searchParams: Promise<{
    salon?: string;
    staff?: string;
    awarded?: string;
    review?: string;
  }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/api/auth/line/login");
  }

  const {
    salon: salonId,
    staff: staffId,
    awarded,
    review: reviewId,
  } = await searchParams;
  if (!salonId) {
    redirect("/");
  }
  const stampAwarded = awarded === "1";

  const [{ data: salon }, { data: stamp }, { data: staff }, rewards, reviewRow] =
    await Promise.all([
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
      // このサロンのVIP特典（表示用・title のみ出す）。
      getSalonRewards(salonId),
      // 購入リンクの可否判定に使う感想（判定に必要な5列のみ・body と rating は取らない）。
      reviewId ? loadReviewForPurchase(reviewId) : Promise.resolve(null),
    ]);

  const count = stamp?.count ?? 0;
  // 無料感想スタンプは「循環型」進捗（CYCLE_SIZE個ごとに特典発動）。@/lib/vip に集約。
  // rewards は表示用に同梱（進捗計算には影響しない）。
  const vip = computeVipProgress(count, rewards);
  // 今回の送信でちょうど1サイクル満了＝特典が発動したか。
  const perkJustFired = stampAwarded && vip.isVIP && vip.progressInCycle === 0;
  const logo = salon?.logo_url ?? null;
  const initials = (salon?.name ?? "").slice(0, 4);

  // 有料スタンプを送れる感想か（/api/checkout と同じ判定・@/lib/review-purchase）。
  // customerId は **セッション由来**で、URL からは受け取らない。
  const canPurchase = isPurchasableReview(reviewRow, {
    customerId: session.customer_id,
    salonId,
    staffId: staffId ?? null,
  });

  return (
    <main className="page">
      <div className="container stack center-text animate-in">
        <header className="stack-sm center-text">
          <Eyebrow>Thank you</Eyebrow>
          <h1 className="headline font-elegant">
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
          <div className="stack stack-sm">
            <p className="body">VIP特典が発動しました。次のサイクルがはじまります。</p>
            {/* 特典内容は title のみ表示・金額/割引率/型は出さない。未設定なら何も出さない。 */}
            {vip.rewards.length > 0 && (
              <ul className="perk-list">
                {vip.rewards.map((reward) => (
                  <li key={reward.id} className="perk-item">
                    {reward.title}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="muted">
            次の特典まであと {vip.toNextPerk} 個（{vip.progressInCycle} / {CYCLE_SIZE}）
          </p>
        )}

        {canPurchase && staffId && staff && reviewId && (
          <div className="stack stack-sm">
            <Eyebrow>Send your thanks</Eyebrow>
            <p className="muted">
              今日の体験を{staff.name}さんに評価スタンプで送れます。
            </p>
            <a
              // reviewed=1：感想は送信済みなので rating 側で「感想だけ送る」を出さない目印。
              // review=：どの感想への評価かを /rating → /api/checkout へ引き継ぐ（§13 決定3）。
              href={`/rating?salon=${encodeURIComponent(salonId)}&staff=${encodeURIComponent(staffId)}&reviewed=1&review=${encodeURIComponent(reviewId)}`}
              className="btn btn-mint btn-block"
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
