import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireManager } from "@/lib/manager-guard";

/**
 * POST /api/manager/kiosk — 受付端末トークンの発行/再発行（[[auth-method-line-b]] の端末経路）。
 *
 * device_token を crypto.randomUUID() で採番し、自店（ctx.salon_id）の salons.device_token を UPDATE する。
 * 発行も再発行も同じ処理（上書き）。再発行すると旧トークンは即無効＝既存キオスクの cookie は
 * getDeviceContext() のDB再照合で失効する（漏洩時対応）。
 *
 * 認可: requireManager（未ログイン401 / 非manager403）。salon は ctx.salon_id 固定（越境不可）。
 * 書き込みは service_role・サーバー側のみ（§3・§8）。応答: 303 /manager/kiosk?issued=1（成功）/ ?error=save。
 */
export const runtime = "nodejs";

export async function POST(): Promise<NextResponse> {
  const gate = await requireManager();
  if (!gate.ok) return gate.res;
  const { ctx } = gate;

  const baseUrl = process.env.APP_BASE_URL!;
  const back = (qs: string) =>
    NextResponse.redirect(new URL(`/manager/kiosk?${qs}`, baseUrl), {
      status: 303,
    });

  const deviceToken = randomUUID();

  const { error } = await supabaseAdmin
    .from("salons")
    .update({ device_token: deviceToken })
    .eq("id", ctx.salon_id);

  if (error) {
    console.error("kiosk device_token issue failed:", error);
    return back("error=save");
  }

  return back("issued=1");
}
