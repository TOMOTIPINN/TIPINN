import { getDeviceContext } from "@/lib/device-session";
import { Eyebrow } from "@/components/ui";
import VisitScanner from "@/app/staff/visit/VisitScanner";

/**
 * 受付端末ホーム（/kiosk・サロンUI世界 / [[auth-method-line-b]] の端末経路）。
 *
 * 据え置き iPad の PWA start_url（/kiosk/setup）が cookie を張って 303 で着地する先。
 * 認可は device cookie のみ（getDeviceContext・DB再照合あり）＝LINE ログインには絶対に飛ばさない。
 * 記録・salon スコープはすべて /api/staff/visit 側（getVisitContext → ctx.salon_id）が担う。
 *
 * スタッフ経路（LINEログイン中）の来店受付は従来どおり /staff/visit。ここは端末専用の独立入口。
 * §8 インラインstyle無し。§5 ¥・鮮やか色を出さない（eyebrow はミント）。
 */
export default async function KioskPage({
  searchParams,
}: {
  searchParams: Promise<{ device?: string }>;
}) {
  const { device } = await searchParams;

  const dctx = await getDeviceContext();

  if (dctx) {
    return (
      <main className="page page-top">
        <div className="container stack animate-in">
          <header className="stack-sm">
            <Eyebrow className="eyebrow-mint">Check-in</Eyebrow>
            <h1 className="headline">来店受付</h1>
            <p className="muted">
              お客様のマイページQRを読み取って、ご来店を記録します。
            </p>
            <p className="muted">この端末は受付端末として登録されています。</p>
          </header>

          <VisitScanner />
        </div>
      </main>
    );
  }

  // 端末未登録/失効（登録URL無効・cookie 消失・再発行後など）。ログインへは飛ばさない。
  return (
    <main className="page">
      <p className="muted center-text">
        {device === "error"
          ? "受付端末の登録に失敗しました。"
          : "この端末はまだ受付端末として登録されていません。"}
        <br />
        店長の管理画面（受付端末）から、最新のQRで登録し直してください。
      </p>
    </main>
  );
}
