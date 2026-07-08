import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { onboardPath } from "@/lib/onboard";
import { Eyebrow, Card } from "@/components/ui";

/**
 * 店頭オンボーディング（/onboard・白世界 / Phase 7・来店軸 / [[auth-method-line-b]]）。
 * 店頭QRから `?salon=<id>&t=<visit_token>` で開く、初来店のお客様の受け口。
 *
 * フロー: echo友だち追加＋LINEログイン（未ログインは returnTo 保持でログインへ。友だち追加は
 *   login route が returnTo=/onboard を見て bot_prompt を付与）→ 顧客レコードは callback が upsert 済み
 *   → 初回来店を1回だけ記録 → salon非依存の顧客ホーム /mypage へ着地。
 * ガード: t を salons.visit_token と照合（不一致/欠落はエラー表示・RPCは呼ばない。/visit と同一作法）。
 * 二重付与防止: submit_visit_and_earn_stamp が (顧客, サロン, 日/JST) で冪等（0009）。同日 /visit と
 *   重複しても二重にならない＝既存ロジック流用のみで追加実装なし。
 * 書き込みは supabaseAdmin・サーバー側のみ。再呼び出しループは作らない（GET表示で一度だけ）。
 */
export default async function OnboardPage({
  searchParams,
}: {
  searchParams: Promise<{ salon?: string; t?: string }>;
}) {
  const { salon: salonId, t: token } = await searchParams;

  const session = await getSession();
  if (!session) {
    // 戻り先は自サイト内ローカルパス（salon/t を保持）。login が /onboard を見て友だち追加を促す。
    const returnTo = onboardPath(salonId ?? "", token ?? "");
    redirect(`/api/auth/line/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  // 失敗時の共通エラー表示（RPCは呼ばない）。
  function errorView(message: string) {
    return (
      <main className="page">
        <div className="container stack center-text animate-in">
          <header className="stack-sm center-text">
            <Eyebrow>Welcome</Eyebrow>
            <h1 className="headline">はじめまして</h1>
          </header>
          <Card>
            <p className="muted center-text">{message}</p>
          </Card>
          <Link href="/" className="btn btn-quiet btn-block">
            ホームへ
          </Link>
        </div>
      </main>
    );
  }

  if (!salonId) {
    return errorView("サロンが指定されていません。店頭のQRから読み込んでください。");
  }

  const { data: salon } = await supabaseAdmin
    .from("salons")
    .select("id, visit_token")
    .eq("id", salonId)
    .maybeSingle();

  // サロン不存在 or トークン不一致/欠落 → 無効なQR（記録しない）。
  if (!salon || !token || token !== salon.visit_token) {
    return errorView("無効なQRです。店頭に掲示された最新のQRから読み込んでください。");
  }

  // 初回来店を記録（1日1回はRPC側で冪等担保）。成功後は顧客ホームへ着地。
  const { error } = await supabaseAdmin.rpc("submit_visit_and_earn_stamp", {
    p_customer_id: session.customer_id,
    p_salon_id: salonId,
  });

  if (error) {
    console.error("submit_visit_and_earn_stamp failed:", error);
    return errorView(
      "登録の記録に失敗しました。時間をおいて、もう一度QRを読み込んでください。",
    );
  }

  // salon非依存の顧客ホームへ（表示名未確定なら /mypage 側のゲートが /onboarding/name を1枚挟む）。
  redirect("/mypage");
}
