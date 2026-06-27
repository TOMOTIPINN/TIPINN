import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireManager } from "@/lib/manager-guard";
import { createInviteToken, inviteExpiryISO, inviteUrl } from "@/lib/staff-invite";

/**
 * POST /api/manager/staff/reissue  — 招待トークンの再発行（A1 / [[auth-method-line-b]]）
 *   入力: staffId（form-data か JSON）。
 *   更新: 自サロン かつ 未紐付け(line_user_id is null) の staff のみ、新トークン＋now+24h を再設定。
 *         紐付け済み・他サロン・不存在は 0件更新 → 404（参加済みは再発行しない）。
 *
 * 認可: requireManager（未ログイン401／非manager403）＋ .eq(salon_id, ctx.salon_id) で越境拒否。
 * 応答: JSON→JSON / フォーム→ /manager/staff?reissued=<id> へ303。
 */
export async function POST(req: Request) {
  const gate = await requireManager();
  if (!gate.ok) return gate.res;
  const { ctx } = gate;

  const isJson = (req.headers.get("content-type") ?? "").includes(
    "application/json",
  );

  let idRaw: unknown;
  if (isJson) {
    const body = await req.json().catch(() => null);
    idRaw = body?.staffId;
  } else {
    const form = await req.formData().catch(() => null);
    idRaw = form?.get("staffId");
  }

  const staffId = typeof idRaw === "string" ? idRaw : "";
  if (!staffId) {
    return NextResponse.json({ error: "missing_staff_id" }, { status: 400 });
  }

  const token = createInviteToken();
  const { data, error } = await supabaseAdmin
    .from("staff")
    .update({ invite_token: token, invite_expires_at: inviteExpiryISO() })
    .eq("id", staffId)
    .eq("salon_id", ctx.salon_id)
    .is("line_user_id", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("staff reissue failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  if (!data) {
    // 他サロン / 不存在 / 既に紐付け済み（参加済みは再発行不可）。
    return NextResponse.json({ error: "not_found" }, { status: 404 });
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
    new URL(`/manager/staff?reissued=${data.id}`, baseUrl),
    { status: 303 },
  );
}
