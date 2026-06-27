import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireManager } from "@/lib/manager-guard";

/**
 * POST /api/manager/rewards/delete  — VIP特典の削除（A3 特典設定 / Phase 6-A）
 *   入力: id。form-data か JSON。
 *   削除: 自サロン（ctx.salon_id）の特典のみ。他サロン/不存在は 0件削除 → 404（越境拒否）。
 *
 * 認可: requireManager（未ログイン401／非manager403）＋ .eq(salon_id, ctx.salon_id)。
 * 応答: JSON→JSON / フォーム→ /manager/rewards?deleted=<id> へ303。
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
    idRaw = body?.id;
  } else {
    const form = await req.formData().catch(() => null);
    idRaw = form?.get("id");
  }

  const id = typeof idRaw === "string" ? idRaw : "";
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  // 自サロンの特典に限定して削除。返り行が無ければ越境/不存在として404。
  const { data, error } = await supabaseAdmin
    .from("rewards")
    .delete()
    .eq("id", id)
    .eq("salon_id", ctx.salon_id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("reward delete failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (isJson) {
    return NextResponse.json({ ok: true, reward_id: data.id });
  }

  const baseUrl = process.env.APP_BASE_URL!;
  return NextResponse.redirect(
    new URL(`/manager/rewards?deleted=${data.id}`, baseUrl),
    { status: 303 },
  );
}
