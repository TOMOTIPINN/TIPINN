import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";
import { resolveSalonRole } from "@/lib/display-role";
import { onboardUrl } from "@/lib/onboard";
import { Eyebrow, Card } from "@/components/ui";
import SalonNav from "@/components/SalonNav";
import SalonQr from "../salon/new/SalonQr";

/**
 * 店頭QR発行（/manager/onboard-qr・サロンUI世界 / [[auth-method-line-b]]）。
 * 店頭に掲示する初来店導線 /onboard?salon=&t= のQRを、店長がいつでも表示・PNG保存できる常設ページ。
 *
 * 認可: 未ログイン→LINEログイン（returnTo）／非スタッフ・非manager は閲覧不可（/manager/staff と同作法）。
 *   salon は ctx.salon_id にスコープ（自店のみ）。
 * QR は onboardUrl（salons.visit_token を再利用）を qrcode でローカル生成（外部送信なし・原則7）。
 *   visit_token はローテートされない安定値のため、印刷・常設のQRとして使える。
 * トーン: サロンUI＝ミント・¥なし・赤なし・インラインstyle禁止（globals.css のトークンのみ）。
 */
export default async function ManagerOnboardQrPage() {
  const session = await getSession();
  if (!session) {
    redirect(
      `/api/auth/line/login?returnTo=${encodeURIComponent("/manager/onboard-qr")}`,
    );
  }

  const ctx = await getStaffContext();
  if (!ctx) {
    return (
      <main className="page">
        <p className="muted center-text">
          このアカウントはスタッフとして登録されていません。
        </p>
      </main>
    );
  }
  if (ctx.role !== "manager") {
    return (
      <main className="page">
        <p className="muted center-text">この画面は店長のみ閲覧できます。</p>
      </main>
    );
  }

  const { data: salon } = await supabaseAdmin
    .from("salons")
    .select("name, visit_token")
    .eq("id", ctx.salon_id)
    .maybeSingle<{ name: string; visit_token: string }>();

  const displayRole = await resolveSalonRole(ctx);

  if (!salon?.visit_token) {
    return (
      <main className="page page-top" data-role={displayRole}>
        <div className="container stack animate-in">
          <SalonNav role={displayRole} />
          <Card>
            <p className="muted center-text">
              店頭QRを発行できませんでした。時間をおいて再度お試しください。
            </p>
          </Card>
        </div>
      </main>
    );
  }

  const baseUrl = process.env.APP_BASE_URL!;
  const url = onboardUrl(baseUrl, ctx.salon_id, salon.visit_token);
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 240 });

  return (
    <main className="page page-top" data-role={displayRole}>
      <div className="container stack animate-in">
        <SalonNav role={displayRole} />
        <header className="stack-sm">
          <Eyebrow className="eyebrow-mint">Store QR</Eyebrow>
          <h1 className="headline">{salon.name} ・ 店頭QR</h1>
          <p className="muted">
            店頭に掲示する初来店受付QRです。お客様がこのQRを読み込むと、友だち追加・LINEログインのあと、初回の来店が記録されます。印刷して常設できます。
          </p>
        </header>

        <Card>
          <div className="qr-block">
            <SalonQr
              qr={qr}
              url={url}
              fileName={`echo-onboard-${ctx.salon_id}.png`}
            />
            <p className="invite-url">{url}</p>
          </div>
        </Card>
      </div>
    </main>
  );
}
