import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  DEVICE_COOKIE_NAME,
  DEVICE_MAX_AGE,
  createDeviceToken,
} from "@/lib/device-session";

/**
 * GET /kiosk/setup?salon=<id>&device=<token> — 受付端末の一度きり登録（[[auth-method-line-b]] の端末経路）。
 *
 * iPad で manager から渡された登録URL（QR）を一度開くと、device_token を httpOnly cookie に保存する。
 * 以後その端末は LINE ログイン無しで受付端末ホーム /kiosk を使える（salon スコープは cookie 内の salon_id 固定）。
 * per-salon manifest の start_url もこの URL＝アイコン起動のたびに cookie を張り直す（standalone 別ジャー・ITP 対策）。
 *
 * 照合: salons を id で引き、device_token が一致し非null のときだけ cookie を発行する（推測URLを弾く）。
 *   一致 → echo_device cookie（署名JWT・httpOnly・1年）→ /kiosk へ（scope /kiosk 内・standalone 維持）。
 *   不一致/未発行/不存在 → /kiosk?device=error（キオスクを LINE ログインに飛ばさない）。
 *
 * Server Component render では cookie を書けないため Route Handler で NextResponse に set する。
 * DBアクセスは service_role・サーバー側のみ（§3）。
 */
export const runtime = "nodejs";

export async function GET(req: Request): Promise<NextResponse> {
  const baseUrl = process.env.APP_BASE_URL!;
  const url = new URL(req.url);
  const salonId = url.searchParams.get("salon")?.trim() ?? "";
  const deviceToken = url.searchParams.get("device")?.trim() ?? "";

  const fail = () =>
    NextResponse.redirect(new URL("/kiosk?device=error", baseUrl), {
      status: 303,
    });

  if (!salonId || !deviceToken) return fail();

  const { data: salon } = await supabaseAdmin
    .from("salons")
    .select("id, device_token")
    .eq("id", salonId)
    .maybeSingle<{ id: string; device_token: string | null }>();

  // サロン不存在 / 未発行 / トークン不一致 → 無効な登録URL（cookie を発行しない）。
  if (!salon || !salon.device_token || salon.device_token !== deviceToken) {
    return fail();
  }

  const jwt = await createDeviceToken({
    salon_id: salon.id,
    device_token: salon.device_token,
  });

  const res = NextResponse.redirect(new URL("/kiosk", baseUrl), {
    status: 303,
  });
  res.cookies.set(DEVICE_COOKIE_NAME, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DEVICE_MAX_AGE,
  });
  return res;
}
