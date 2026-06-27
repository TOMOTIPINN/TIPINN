import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Eyebrow, Card } from "@/components/ui";

/**
 * 来店記録（/visit・白世界 / Phase 7・来店軸）。
 * 店内QRから `?salon=<id>&t=<visit_token>` で開く。読み込み時に1回だけ来店を記録する。
 *
 * 認可: LINEログイン必須（未ログインは returnTo 保持でログインへ・QR導線）。
 * ガード: t を salons.visit_token と照合（不一致/欠落はエラー表示・RPCは呼ばない＝固定URL使い回しの最低限ガード）。
 * 記録: 照合OKなら supabaseAdmin.rpc("submit_visit_and_earn_stamp")。1日1回はRPC側(0009)で担保（冪等）。
 *   stamp_awarded=true → 来店スタンプ +1 / false → 本日は記録済み。
 * ※ visit_axis_enabled はここでは判定しない（常に記録・表示ON/OFFは /mypage の責務）。
 * 書き込みは supabaseAdmin・サーバー側のみ。再呼び出しループは作らない（GET表示で一度だけ）。
 */
export default async function VisitPage({
  searchParams,
}: {
  searchParams: Promise<{ salon?: string; t?: string }>;
}) {
  const { salon: salonId, t: token } = await searchParams;

  const session = await getSession();
  if (!session) {
    // 戻り先は自サイト内ローカルパス（salon/t を保持）。sanitizeReturnTo 互換。
    const returnTo = `/visit?salon=${encodeURIComponent(salonId ?? "")}&t=${encodeURIComponent(token ?? "")}`;
    redirect(`/api/auth/line/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  // 失敗時の共通エラー表示（RPCは呼ばない）。
  function errorView(message: string) {
    return (
      <main className="page">
        <div className="container stack center-text animate-in">
          <header className="stack-sm center-text">
            <Eyebrow>Visit</Eyebrow>
            <h1 className="headline">来店記録</h1>
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
    return errorView("サロンが指定されていません。店内のQRから読み込んでください。");
  }

  const { data: salon } = await supabaseAdmin
    .from("salons")
    .select("id, name, visit_token")
    .eq("id", salonId)
    .maybeSingle();

  // サロン不存在 or トークン不一致/欠落 → 無効なQR（記録しない）。
  if (!salon || !token || token !== salon.visit_token) {
    return errorView("無効なQRです。店内に掲示された最新のQRから読み込んでください。");
  }

  const { data, error } = await supabaseAdmin.rpc("submit_visit_and_earn_stamp", {
    p_customer_id: session.customer_id,
    p_salon_id: salonId,
  });

  if (error) {
    console.error("submit_visit_and_earn_stamp failed:", error);
    return errorView("来店の記録に失敗しました。時間をおいて、もう一度QRを読み込んでください。");
  }

  const r = (Array.isArray(data) ? data[0] : data) as {
    new_count: number;
    stamp_awarded: boolean;
  };
  const newCount = r?.new_count ?? 0;
  const awarded = r?.stamp_awarded === true;

  return (
    <main className="page">
      <div className="container stack center-text animate-in">
        <header className="stack-sm center-text">
          <Eyebrow>Visit</Eyebrow>
          <h1 className="headline font-elegant">ご来店ありがとうございます</h1>
          <p className="muted">{salon.name}</p>
        </header>

        <Card>
          {awarded ? (
            <p className="body center-text">
              来店スタンプ +1（累計 {newCount} 回）
            </p>
          ) : (
            <p className="muted center-text">
              本日は記録済みです（累計 {newCount} 回）
            </p>
          )}
        </Card>

        <div className="stack stack-sm">
          <Link href="/mypage" className="btn btn-outline btn-block">
            マイページで確認する
          </Link>
          <Link href="/" className="btn btn-quiet btn-block">
            ホームへ
          </Link>
        </div>
      </div>
    </main>
  );
}
