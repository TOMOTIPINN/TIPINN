import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * GET /kiosk/manifest?salon=<id>&device=<token> — 受付端末（キオスク）専用の per-salon PWA manifest。
 *
 * 目的: 据え置き iPad を「{サロン名} 受付」という独立アプリとしてホーム画面に追加できるようにする。
 *   - start_url を /kiosk/setup?salon=&device= にする＝アイコン起動のたびに setup を通し、
 *     echo_device cookie を張り直す（standalone の別 cookie ジャー隔離・iOS ITP 失効を都度救う）。
 *   - scope を /kiosk（末尾スラッシュ無し）にして、start_url→303→/kiosk の遷移を全て scope 内に閉じる
 *     （scope の within 判定はパス前方一致。"/kiosk/" だと "/kiosk" が外れるため末尾スラッシュ無し）。
 *     /api/staff/visit は fetch（サブリソース）で scope 対象外＝越えても standalone は維持される。
 *
 * 検証: salon を id で引き device_token 一致・非null のときだけ manifest を返す（推測URLで他店 manifest を
 *   作らせない）。不一致/未発行/不存在は 404。
 *
 * ⚠️ start_url に device_token が載る。据え置き受付端末のみを対象とし、httpOnly cookie ほどは隠れない
 *   ことを承知の上での設計判断（CLAUDE.md §11 参照）。紛失時は /manager/kiosk で再発行すれば全端末失効。
 *
 * DBアクセスは service_role・サーバー側のみ（§3）。
 */
export const runtime = "nodejs";

export async function GET(req: Request): Promise<NextResponse> {
  const baseUrl = process.env.APP_BASE_URL!;
  const url = new URL(req.url);
  const salonId = url.searchParams.get("salon")?.trim() ?? "";
  const deviceToken = url.searchParams.get("device")?.trim() ?? "";

  if (!salonId || !deviceToken) {
    return new NextResponse("not found", { status: 404 });
  }

  const { data: salon } = await supabaseAdmin
    .from("salons")
    .select("id, name, device_token")
    .eq("id", salonId)
    .maybeSingle<{ id: string; name: string; device_token: string | null }>();

  if (!salon || !salon.device_token || salon.device_token !== deviceToken) {
    return new NextResponse("not found", { status: 404 });
  }

  const salonName = salon.name?.trim() || "サロン";
  const startUrl = `${baseUrl}/kiosk/setup?salon=${salon.id}&device=${salon.device_token}`;

  const manifest = {
    id: "/kiosk",
    name: `${salonName} 受付`,
    short_name: `${salonName} 受付`,
    description: `${salonName} の来店受付端末。ホーム画面から開くとすぐにご来店を記録できます。`,
    start_url: startUrl,
    scope: "/kiosk",
    display: "standalone",
    background_color: "#FFFEFC",
    theme_color: "#FFFEFC",
    orientation: "portrait",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "48x48",
        type: "image/x-icon",
      },
    ],
  };

  return new NextResponse(JSON.stringify(manifest), {
    status: 200,
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      // 端末別・再発行で内容が変わるためキャッシュさせない。
      "Cache-Control": "no-store",
    },
  });
}
