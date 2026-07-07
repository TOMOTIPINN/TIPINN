import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireManager } from "@/lib/manager-guard";

/**
 * POST /api/manager/staff/archive — スタッフの退職アーカイブ/復帰（論理削除・[[auth-method-line-b]]）
 *   入力: staffId ＋ action（"archive" | "unarchive"。既定 archive）。
 *   更新: 自サロンの staff のみ archived_at を now()（退職）/ null（復帰）に更新。
 *
 * 保全: reviews.staff_id / rating_purchases.staff_id は一切触らない（過去実績・金額台帳の attribution 保持）。
 *       line_user_id / invite_token も触らない（④復帰時にそのまま戻す）。
 * 認可: requireManager（未ログイン401 / 非manager403）＋ .eq(salon_id, ctx.salon_id) で越境拒否。
 * 応答: JSON→JSON / フォーム→ /manager/staff?archived=1 | ?restored=1 へ303。
 */
export async function POST(req: Request) {
  const gate = await requireManager();
  if (!gate.ok) return gate.res;
  const { ctx } = gate;
  const baseUrl = process.env.APP_BASE_URL!;

  const isJson = (req.headers.get("content-type") ?? "").includes(
    "application/json",
  );

  let idRaw: unknown;
  let actionRaw: unknown;
  if (isJson) {
    const body = await req.json().catch(() => null);
    idRaw = body?.staffId;
    actionRaw = body?.action;
  } else {
    const form = await req.formData().catch(() => null);
    idRaw = form?.get("staffId");
    actionRaw = form?.get("action");
  }

  const staffId = typeof idRaw === "string" ? idRaw : "";
  // 既定は archive。明示的に "unarchive" のときだけ復帰。
  const action = actionRaw === "unarchive" ? "unarchive" : "archive";
  if (!staffId) {
    return NextResponse.json({ error: "missing_staff_id" }, { status: 400 });
  }

  const archivedAt =
    action === "unarchive" ? null : new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("staff")
    .update({ archived_at: archivedAt })
    .eq("id", staffId)
    .eq("salon_id", ctx.salon_id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("staff archive failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  if (!data) {
    // 他サロン / 不存在。
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (isJson) {
    return NextResponse.json({
      ok: true,
      staff_id: data.id,
      archived: action === "archive",
    });
  }

  const flag = action === "unarchive" ? "restored=1" : "archived=1";
  return NextResponse.redirect(new URL(`/manager/staff?${flag}`, baseUrl), {
    status: 303,
  });
}
