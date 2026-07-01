import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Eyebrow } from "@/components/ui";
import RatingPicker from "./RatingPicker";

/**
 * 評価スタンプを選ぶ（画面マップ04・白世界・4.1）。
 * サーバーコンポーネントで getSession() を検証し、未ログインはログインへ。
 * 対象は ?salon=<uuid>&staff=<uuid>。サロン名・スタッフ名のみ service role で解決して渡す。
 * tier の選択 → /api/checkout → Stripe Checkout（Direct Charge）へ遷移する。
 */
export default async function RatingPage({
  searchParams,
}: {
  searchParams: Promise<{ salon?: string; staff?: string; reviewed?: string }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/api/auth/line/login");
  }

  const { salon: salonId, staff: staffId, reviewed } = await searchParams;
  // reviewed が付いていれば感想は送信済み → 「感想だけ送る」は不要。
  // フェイルセーフ：値が無ければ falsy として現状どおり表示する（緩い存在判定）。
  const alreadyReviewed = Boolean(reviewed);
  if (!salonId || !staffId) {
    return (
      <main className="page">
        <p className="muted center-text">評価の対象が指定されていません。</p>
      </main>
    );
  }

  const [{ data: salon }, { data: staff }] = await Promise.all([
    supabaseAdmin.from("salons").select("name").eq("id", salonId).single(),
    supabaseAdmin
      .from("staff")
      .select("name")
      .eq("id", staffId)
      .eq("salon_id", salonId)
      .single(),
  ]);

  if (!salon || !staff) {
    return (
      <main className="page">
        <p className="muted center-text">評価の対象が見つかりませんでした。</p>
      </main>
    );
  }

  return (
    <main className="page page-top">
      <div className="container stack animate-in">
        <header className="stack-sm center-text">
          <Eyebrow>Rate your experience</Eyebrow>
          <h1 className="headline">評価スタンプを選んでください</h1>
          <p className="muted">
            評価対象：{staff.name}さんの接客（{salon.name}）
          </p>
        </header>

        <RatingPicker salonId={salonId} staffId={staffId} reviewed={alreadyReviewed} />

        {!alreadyReviewed && (
          <a
            href={`/review?salon=${encodeURIComponent(salonId)}`}
            className="btn btn-quiet btn-block"
          >
            感想だけ送る
          </a>
        )}
      </div>
    </main>
  );
}
