import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";
import { Eyebrow, Card } from "@/components/ui";
import SalonNav from "@/components/SalonNav";
import SalonQr from "@/app/manager/salon/new/SalonQr";

/**
 * 受付端末（キオスク）設定（/manager/kiosk・サロンUI世界 / [[auth-method-line-b]] の端末経路）。
 * 店長がこの店の受付端末トークン（device_token）を発行/再発行し、iPad に読ませる登録URL（QR）を表示する。
 *
 * 認可: /dashboard と同型。未ログイン→LINEログイン（returnTo）／非manager→/staff。salon は ctx.salon_id。
 * 発行済みなら /kiosk/setup?salon=&device= を QR＋コピーで表示（iPadで一度開くと据え置き端末になる）。
 * トーン: サロンUI＝ミント・¥なし・赤なし・インラインstyle禁止（§8）。
 */
export default async function ManagerKioskPage({
  searchParams,
}: {
  searchParams: Promise<{ issued?: string; error?: string }>;
}) {
  const { issued, error } = await searchParams;

  const session = await getSession();
  if (!session) {
    redirect(
      `/api/auth/line/login?returnTo=${encodeURIComponent("/manager/kiosk")}`,
    );
  }
  const ctx = await getStaffContext();
  if (!ctx || ctx.role !== "manager") {
    redirect("/staff");
  }

  const { data: salon } = await supabaseAdmin
    .from("salons")
    .select("name, device_token")
    .eq("id", ctx.salon_id)
    .maybeSingle<{ name: string; device_token: string | null }>();

  const salonName = salon?.name ?? "サロン";
  const deviceToken = salon?.device_token ?? null;

  const baseUrl = process.env.APP_BASE_URL!;
  let setupUrl: string | null = null;
  let qr: string | null = null;
  if (deviceToken) {
    setupUrl = `${baseUrl}/kiosk/setup?salon=${ctx.salon_id}&device=${deviceToken}`;
    qr = await QRCode.toDataURL(setupUrl, { margin: 1, width: 240 });
  }

  return (
    <main className="page page-top">
      <div className="container stack animate-in">
        <SalonNav />
        <header className="stack-sm">
          <Eyebrow className="eyebrow-mint">Reception device</Eyebrow>
          <h1 className="headline">{salonName} ・ 受付端末</h1>
          <p className="muted">
            店頭の iPad を常設の受付端末にします。下のQRを iPad で一度読み込むと、LINEログイン無しで
            来店受付が使えるようになります。
          </p>
        </header>

        {issued && (
          <div className="notice notice-success">
            端末トークンを発行しました。下のQRを受付端末で読み込んでください。
          </div>
        )}
        {error === "save" && (
          <div className="notice notice-error">
            発行に失敗しました。時間をおいて再度お試しください。
          </div>
        )}

        {deviceToken && qr && setupUrl ? (
          <Card>
            <div className="qr-block">
              <Eyebrow className="eyebrow-mint">Device setup</Eyebrow>
              <SalonQr
                qr={qr}
                url={setupUrl}
                fileName={`echo-kiosk-${ctx.salon_id}.png`}
              />
              <p className="invite-url">{setupUrl}</p>
            </div>
          </Card>
        ) : (
          <Card>
            <p className="muted center-text">
              まだ受付端末トークンが発行されていません。下のボタンから発行してください。
            </p>
          </Card>
        )}

        <Card>
          <form action="/api/manager/kiosk" method="post" className="stack-md">
            <Eyebrow className="eyebrow-mint">
              {deviceToken ? "Reissue" : "Issue"}
            </Eyebrow>
            <p className="muted">
              {deviceToken
                ? "端末を紛失・入れ替えたときは再発行してください。再発行すると、これまでの登録端末はすべて無効になり、新しいQRでの再登録が必要になります。"
                : "この店の受付端末トークンを発行します。"}
            </p>
            <button type="submit" className="btn btn-outline btn-block">
              {deviceToken ? "端末トークンを再発行" : "端末トークンを発行"}
            </button>
          </form>
        </Card>
      </div>
    </main>
  );
}
