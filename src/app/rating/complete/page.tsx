import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Eyebrow } from "@/components/ui";

/**
 * 評価スタンプ 購入完了画面（画面マップ06系・白世界・4.3）。
 * Checkout の success_url の遷移先。`?session_id=cs_test_...` を受け取る（表示はしない）。
 *
 * ★この画面ではDB書き込みをしない。記録は Webhook(4.2) の仕事（二重記録防止）。
 *   ここは純粋に UX（温かいサンキュー確認）のみ。
 * トーン: 「サロンへの評価」「スタッフへの感謝」。お金はサロンへ／スタッフへ直接ではない（原則5）。
 *   2026-10-16（§30 #2）: 「いただいた評価は、サロンを通じてスタッフの励みとして大切に活かされます。」は
 *   代金がスタッフに渡ると読まれうるため、山口先生の案文に差し替えた。
 *   同日、上の段落の「担当スタッフへの励みになります。」も消した。支払いの直後に出るため
 *   チップのように受け取られやすい（00 §4.2）。スタッフに届いたことは下の段落で伝わる。
 *   同日、下の段落の「お支払いはサロンへ。」も消した（上の段落の「あなたの評価がサロンへ。」と重なって読みにくいため）。
 *   代金がサロンへ支払われることは、購入画面の確認ステップ（.confirm-note）で伝えている。
 *
 * NOTE: tier/金額の表示は Direct Charge ゆえ Session 取得に stripeAccount が要るため MVP では省略。
 */
export default async function RatingCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/api/auth/line/login");
  }

  // session_id は受け取るだけ（記録は webhook 済み）。await は Next.js 16 のため必須。
  await searchParams;

  return (
    <main className="page">
      <div className="container stack center-text animate-in">
        <header className="stack-sm center-text">
          <Eyebrow>Thank you</Eyebrow>
          <h1 className="headline font-elegant">
            評価スタンプを
            <br />
            お届けしました
          </h1>
        </header>

        <p className="body text-balance font-elegant">
          あなたの評価がサロンへ。
          <br />
          あたたかい感謝と評価として届きました。
        </p>

        <p className="muted text-balance">
          ありがとうございました。あなたの評価とお気持ちは、サロンとスタッフに届きました。
        </p>

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
