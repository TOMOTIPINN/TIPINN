import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { hasReviewedToday } from "@/lib/review-server";
import { Eyebrow } from "@/components/ui";
import ReviewForm from "./ReviewForm";

/**
 * 感想フォーム（白世界・§5 / 画面マップ 03 の土台）。
 * 評価・タグ・共有範囲はこのコミットでは未実装。見た目の土台のみ。
 * サーバーコンポーネントで getSession() を検証し、未ログインならログインへ送る。
 * 対象サロンは ?salon=<uuid>。サロン名のみ service role で解決して渡す（原則7）。
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ salon?: string }>;
}) {
  // returnTo に元のパス（?salon=…）を載せるため、salonId を先に解決する。
  // 未ログインでログインへ飛ばす際、ログイン後に同じ /review へ戻すため（QR/通知導線・§8）。
  const { salon: salonId } = await searchParams;

  const session = await getSession();
  if (!session) {
    const returnTo = salonId
      ? `/review?salon=${encodeURIComponent(salonId)}`
      : "/review";
    redirect(`/api/auth/line/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  if (!salonId) {
    return (
      <main className="page">
        <p className="muted center-text">サロンが指定されていません。</p>
      </main>
    );
  }

  const { data: salon } = await supabaseAdmin
    .from("salons")
    .select("name")
    .eq("id", salonId)
    .single();

  if (!salon) {
    return (
      <main className="page">
        <p className="muted center-text">サロンが見つかりませんでした。</p>
      </main>
    );
  }

  // 本日分の感想は「1顧客/1サロン/JST日 につき1回」。既送信ならフォームを出さず、
  // URL直打ち・リロードでも同じ既送信カードを返す（客を責めない・要件2）。
  // 本当の砦は RPC（0020）。ここは表示の belt。
  if (await hasReviewedToday(session.customer_id, salonId)) {
    return (
      <main className="page">
        <div className="container stack center-text animate-in">
          <header className="stack-sm center-text">
            <Eyebrow>Thank you</Eyebrow>
            <h1 className="headline font-elegant">本日分の感想は送信済みです</h1>
            <p className="muted">{salon.name}</p>
          </header>
          <p className="body">またのご来店をお待ちしています。</p>
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

  return (
    <main className="page">
      <div className="container stack animate-in">
        <header className="stack-sm center-text">
          <Eyebrow>Share your feedback</Eyebrow>
          <h1 className="headline">感想を送る</h1>
          <p className="muted">{salon.name}</p>
        </header>

        <ReviewForm salonId={salonId} />
      </div>
    </main>
  );
}
