import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireManager } from "@/lib/manager-guard";

/**
 * POST /api/manager/visit  — 来店スタンプ軸の設定（来店軸 / Phase 7・ブロック4）
 *   入力: visit_axis_enabled（チェックボックス＝存在でtrue/欠落でfalse・JSONはboolean）
 *         visit_cycle_size（整数 10〜20・migration 0009 の CHECK と一致）。form-data か JSON。
 *   更新: 自サロン（ctx.salon_id）のみ。salon_id はセッション由来固定（クライアントから受けない）。
 *
 * 認可: requireManager（未ログイン401／非manager403）＋ .eq("id", ctx.salon_id)（越境不可・0件→404）。
 * 応答: JSON→JSON / フォーム→ /manager/visit?saved=1 へ303（range違反は ?error=range）。
 */
const CYCLE_MIN = 10;
const CYCLE_MAX = 20;
const NOTIFY_MIN = 10;
const NOTIFY_MAX = 360;
const NOTIFY_STEP = 10;

export async function POST(req: Request) {
  const gate = await requireManager();
  if (!gate.ok) return gate.res;
  const { ctx } = gate;

  const isJson = (req.headers.get("content-type") ?? "").includes(
    "application/json",
  );
  const baseUrl = process.env.APP_BASE_URL!;

  // body/form を1度だけ読み、section で保存対象を分岐（single-read: bodyは二重取得できない）。
  const body = isJson ? await req.json().catch(() => null) : null;
  const form = isJson ? null : await req.formData().catch(() => null);
  const field = (name: string): unknown =>
    isJson ? body?.[name] : form?.get(name);

  // ── 来店後の感想リクエスト（notify_after_minutes 単体保存・他フィールド非巻き込み）──
  if (field("section") === "notify") {
    const notifyRaw = field("notify_after_minutes");
    const mins =
      typeof notifyRaw === "number"
        ? notifyRaw
        : typeof notifyRaw === "string" && notifyRaw.trim() !== ""
          ? Number(notifyRaw)
          : NaN;
    // DB の CHECK（10〜360 かつ 10の倍数）と一致。整数かつ 10分刻みのみ許可。
    if (
      !Number.isInteger(mins) ||
      mins < NOTIFY_MIN ||
      mins > NOTIFY_MAX ||
      mins % NOTIFY_STEP !== 0
    ) {
      if (isJson) {
        return NextResponse.json(
          { error: "invalid_notify_after_minutes" },
          { status: 400 },
        );
      }
      return NextResponse.redirect(
        new URL(`/manager/visit?error=notify_range`, baseUrl),
        { status: 303 },
      );
    }

    // notify_after_minutes のみ更新（visit_axis_enabled / visit_cycle_size は触らない）。
    const { data, error } = await supabaseAdmin
      .from("salons")
      .update({ notify_after_minutes: mins })
      .eq("id", ctx.salon_id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("notify settings update failed:", error);
      return NextResponse.json({ error: "server_error" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    if (isJson) {
      return NextResponse.json({ ok: true, notify_after_minutes: mins });
    }
    return NextResponse.redirect(
      new URL(`/manager/visit?saved=1`, baseUrl),
      { status: 303 },
    );
  }

  // 未チェックのcheckboxはフィールド自体が送られない＝存在でtrue。
  const enabled = isJson
    ? body?.visit_axis_enabled === true
    : form?.get("visit_axis_enabled") != null;
  const sizeRaw = field("visit_cycle_size");

  // 数値化（form-dataは文字列）。整数かつ 10〜20 のみ許可。
  const size =
    typeof sizeRaw === "number"
      ? sizeRaw
      : typeof sizeRaw === "string" && sizeRaw.trim() !== ""
        ? Number(sizeRaw)
        : NaN;
  if (!Number.isInteger(size) || size < CYCLE_MIN || size > CYCLE_MAX) {
    if (isJson) {
      return NextResponse.json({ error: "invalid_cycle_size" }, { status: 400 });
    }
    return NextResponse.redirect(
      new URL(`/manager/visit?error=range`, baseUrl),
      { status: 303 },
    );
  }

  // 自サロンに限定して更新。返り行が無ければ越境/不存在として404。
  const { data, error } = await supabaseAdmin
    .from("salons")
    .update({ visit_axis_enabled: enabled, visit_cycle_size: size })
    .eq("id", ctx.salon_id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("visit settings update failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (isJson) {
    return NextResponse.json({
      ok: true,
      visit_axis_enabled: enabled,
      visit_cycle_size: size,
    });
  }

  return NextResponse.redirect(new URL(`/manager/visit?saved=1`, baseUrl), {
    status: 303,
  });
}
