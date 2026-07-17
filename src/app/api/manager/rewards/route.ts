import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireManager } from "@/lib/manager-guard";
import { MAX_REWARDS, REWARD_TYPE, type RewardType } from "@/lib/rewards";
import { CYCLE_SIZE } from "@/lib/vip";

/**
 * POST /api/manager/rewards  — VIP特典の新規作成（A3 特典設定 / Phase 6-A）
 *   入力: reward_type（割引/サービス/優先）＋ title（自由テキスト）。form-data か JSON。
 *   固定: salon_id=ctx.salon_id（クライアントから受けない）/ required_count=CYCLE_SIZE（=3・サーバー固定）。
 *         サイクルは常に3固定（@/lib/vip）なので店長には発動個数を入力させない（全行 同一 required_count）。
 *
 * 認可: requireManager（未ログイン401／非manager403）。書き込みは service_role・サーバー側のみ（§8）。
 * 上限: 1サロン最大 MAX_REWARDS(=2) 件。既に達していれば作成拒否（JSON→409 / フォーム→?error=limit）。
 * 応答: JSON→JSON / フォーム→ /manager/rewards?created=<id> へ303。
 */
const TITLE_MAX = 60;

export async function POST(req: Request) {
  const gate = await requireManager();
  if (!gate.ok) return gate.res;
  const { ctx } = gate;

  const isJson = (req.headers.get("content-type") ?? "").includes(
    "application/json",
  );

  let typeRaw: unknown;
  let titleRaw: unknown;
  let consumableRaw: unknown;
  if (isJson) {
    const body = await req.json().catch(() => null);
    typeRaw = body?.reward_type;
    titleRaw = body?.title;
    consumableRaw = body?.is_consumable;
  } else {
    const form = await req.formData().catch(() => null);
    typeRaw = form?.get("reward_type");
    titleRaw = form?.get("title");
    consumableRaw = form?.get("is_consumable");
  }

  if (!REWARD_TYPE.includes(typeRaw as RewardType)) {
    return NextResponse.json({ error: "invalid_reward_type" }, { status: 400 });
  }
  const reward_type = typeRaw as RewardType;

  const title = typeof titleRaw === "string" ? titleRaw.trim() : "";
  if (!title || title.length > TITLE_MAX) {
    return NextResponse.json({ error: "invalid_title" }, { status: 400 });
  }

  // 特典の使い方 = is_consumable。フォームは "consumable"/"permanent"、JSON は boolean も許容。
  // 未知値・欠落は false（＝ずっと使える／状態型）＝0025 の既定と一致（明示的に選んだときだけ1回きり）。
  const is_consumable = consumableRaw === "consumable" || consumableRaw === true;

  // 上限チェック（自サロンのみ・件数のみ取得）。
  const { count, error: countError } = await supabaseAdmin
    .from("rewards")
    .select("id", { count: "exact", head: true })
    .eq("salon_id", ctx.salon_id);

  if (countError) {
    console.error("rewards count failed:", countError);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  if ((count ?? 0) >= MAX_REWARDS) {
    if (isJson) {
      return NextResponse.json({ error: "limit_reached" }, { status: 409 });
    }
    const baseUrl = process.env.APP_BASE_URL!;
    return NextResponse.redirect(
      new URL(`/manager/rewards?error=limit`, baseUrl),
      { status: 303 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("rewards")
    .insert({
      salon_id: ctx.salon_id,
      reward_type,
      title,
      required_count: CYCLE_SIZE, // サイクル固定3。発動個数は店長に触らせない。
      is_consumable, // 既定 false（状態型）。店長が「1回きり」を選んだときだけ true。
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("reward create failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  if (isJson) {
    return NextResponse.json({ ok: true, reward_id: data.id });
  }

  const baseUrl = process.env.APP_BASE_URL!;
  return NextResponse.redirect(
    new URL(`/manager/rewards?created=${data.id}`, baseUrl),
    { status: 303 },
  );
}
