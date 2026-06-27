import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireManager } from "@/lib/manager-guard";
import { REWARD_TYPE, type RewardType } from "@/lib/rewards";

/**
 * POST /api/manager/rewards/update  — VIP特典の編集（A3 特典設定 / Phase 6-A）
 *   入力: id ＋ reward_type ＋ title。form-data か JSON。required_count は変更しない（サイクル3固定）。
 *   更新: 自サロン（ctx.salon_id）の特典のみ。他サロン/不存在は 0件更新 → 404（越境拒否）。
 *
 * 認可: requireManager（未ログイン401／非manager403）＋ .eq(salon_id, ctx.salon_id)。
 * 応答: JSON→JSON / フォーム→ /manager/rewards?updated=<id> へ303。
 */
const TITLE_MAX = 60;

export async function POST(req: Request) {
  const gate = await requireManager();
  if (!gate.ok) return gate.res;
  const { ctx } = gate;

  const isJson = (req.headers.get("content-type") ?? "").includes(
    "application/json",
  );

  let idRaw: unknown;
  let typeRaw: unknown;
  let titleRaw: unknown;
  if (isJson) {
    const body = await req.json().catch(() => null);
    idRaw = body?.id;
    typeRaw = body?.reward_type;
    titleRaw = body?.title;
  } else {
    const form = await req.formData().catch(() => null);
    idRaw = form?.get("id");
    typeRaw = form?.get("reward_type");
    titleRaw = form?.get("title");
  }

  const id = typeof idRaw === "string" ? idRaw : "";
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }
  if (!REWARD_TYPE.includes(typeRaw as RewardType)) {
    return NextResponse.json({ error: "invalid_reward_type" }, { status: 400 });
  }
  const reward_type = typeRaw as RewardType;

  const title = typeof titleRaw === "string" ? titleRaw.trim() : "";
  if (!title || title.length > TITLE_MAX) {
    return NextResponse.json({ error: "invalid_title" }, { status: 400 });
  }

  // 自サロンの特典に限定して更新。返り行が無ければ越境/不存在として404。
  const { data, error } = await supabaseAdmin
    .from("rewards")
    .update({ reward_type, title })
    .eq("id", id)
    .eq("salon_id", ctx.salon_id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("reward update failed:", error);
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
    new URL(`/manager/rewards?updated=${data.id}`, baseUrl),
    { status: 303 },
  );
}
