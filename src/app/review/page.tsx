import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
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
  const session = await getSession();
  if (!session) {
    redirect("/api/auth/line/login");
  }

  const { salon: salonId } = await searchParams;
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
