import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireManager } from "@/lib/manager-guard";
import { createInviteToken, inviteExpiryISO, inviteUrl } from "@/lib/staff-invite";

/**
 * POST /api/manager/staff  — スタッフ新規作成＋招待発行（A1 管理画面 / [[auth-method-line-b]]）
 *   入力: name（form-data か JSON）。salon_id/role はクライアントから受け取らない。
 *   作成: staff{ salon_id=ctx.salon_id, name, role='staff', invite_token, invite_expires_at=now+24h }
 *
 * 認可: requireManager（未ログイン401／非manager403）。salon は必ずセッション由来（越境不可）。
 * 応答: JSONリクエスト→JSON（curl用）/ それ以外（フォーム送信）→ /manager/staff?created=<id> へ303。
 */
const NAME_MAX = 50;

export async function POST(req: Request) {
  const gate = await requireManager();
  if (!gate.ok) return gate.res;
  const { ctx } = gate;

  const isJson = (req.headers.get("content-type") ?? "").includes(
    "application/json",
  );

  let nameRaw: unknown;
  if (isJson) {
    const body = await req.json().catch(() => null);
    nameRaw = body?.name;
  } else {
    const form = await req.formData().catch(() => null);
    nameRaw = form?.get("name");
  }

  const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
  if (!name || name.length > NAME_MAX) {
    return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  }

  const token = createInviteToken();
  const { data, error } = await supabaseAdmin
    .from("staff")
    .insert({
      salon_id: ctx.salon_id,
      name,
      role: "staff",
      invite_token: token,
      invite_expires_at: inviteExpiryISO(),
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("staff create failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  if (isJson) {
    const baseUrl = process.env.APP_BASE_URL!;
    return NextResponse.json({
      ok: true,
      staff_id: data.id,
      invite_url: inviteUrl(baseUrl, token),
    });
  }

  const baseUrl = process.env.APP_BASE_URL!;
  return NextResponse.redirect(
    new URL(`/manager/staff?created=${data.id}`, baseUrl),
    { status: 303 },
  );
}
