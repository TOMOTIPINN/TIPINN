import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireManager } from "@/lib/manager-guard";
import { createInviteToken, inviteExpiryISO, inviteUrl } from "@/lib/staff-invite";

/**
 * POST /api/manager/staff  — スタッフ新規作成＋招待発行（A1 管理画面 / [[auth-method-line-b]]）
 *   入力: name, role, idempotency_key（form-data か JSON）。role は staff|manager をホワイトリスト検証（既定 staff）。salon_id はクライアントから受け取らない。
 *   作成: staff{ salon_id=ctx.salon_id, name, role, invite_token, invite_expires_at=now+24h, idempotency_key }
 *
 * 二重送信防止（migration 0023）: クライアントがフォームを開いた時点で生成した uuid を idempotency_key として受け取り、
 *   upsert(onConflict=idempotency_key, ignoreDuplicates) ＝ INSERT ... ON CONFLICT DO NOTHING で握り潰す。
 *   2回目の送信（二度押し）は挿入されず、既存行を引いて1回目と同じ staff_id / invite_url を返す（冪等）。
 *   idempotency_key が無い/不正な呼び出し（curl・JS無効）はサーバー側で生成してフォールバック（dedup 効果はなし）。
 *
 * 認可: requireManager（未ログイン401／非manager403）。salon は必ずセッション由来（越境不可）。
 * 応答: JSONリクエスト→JSON（curl用）/ それ以外（フォーム送信）→ /manager/staff?created=<id> へ303。
 */
const NAME_MAX = 50;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const gate = await requireManager();
  if (!gate.ok) return gate.res;
  const { ctx } = gate;

  const isJson = (req.headers.get("content-type") ?? "").includes(
    "application/json",
  );

  let nameRaw: unknown;
  let roleRaw: unknown;
  let idemRaw: unknown;
  if (isJson) {
    const body = await req.json().catch(() => null);
    nameRaw = body?.name;
    roleRaw = body?.role;
    idemRaw = body?.idempotency_key;
  } else {
    const form = await req.formData().catch(() => null);
    nameRaw = form?.get("name");
    roleRaw = form?.get("role");
    idemRaw = form?.get("idempotency_key");
  }

  const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
  if (!name || name.length > NAME_MAX) {
    return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  }

  // 役割はホワイトリスト検証（未指定・不正値は staff にフォールバック）
  const role = roleRaw === "manager" ? "manager" : "staff";

  // 二重送信防止キー: クライアント生成の uuid。無い/不正ならサーバー側で生成（dedup 効果はなし・
  // curl や JS 無効クライアント向けのフォールバック）。
  const idempotencyKey =
    typeof idemRaw === "string" && UUID_RE.test(idemRaw)
      ? idemRaw
      : crypto.randomUUID();

  const token = createInviteToken();
  // INSERT ... ON CONFLICT (idempotency_key) DO NOTHING。二度押しの2回目は挿入されず select が空になる。
  const { data, error } = await supabaseAdmin
    .from("staff")
    .upsert(
      {
        salon_id: ctx.salon_id,
        name,
        role,
        invite_token: token,
        invite_expires_at: inviteExpiryISO(),
        idempotency_key: idempotencyKey,
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true },
    )
    .select("id, invite_token")
    .maybeSingle();

  if (error) {
    console.error("staff create failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  // conflict（＝二度押しの2回目）で行が返らなかった場合は、同じ idempotency_key の既存行を引いて
  // 1回目と同じ結果を返す（冪等・重複行を作らない）。
  let staff = data;
  if (!staff) {
    const { data: existing } = await supabaseAdmin
      .from("staff")
      .select("id, invite_token")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    staff = existing;
  }

  if (!staff) {
    console.error("staff create: no row after upsert", { idempotencyKey });
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  const baseUrl = process.env.APP_BASE_URL!;
  if (isJson) {
    return NextResponse.json({
      ok: true,
      staff_id: staff.id,
      // 既存行の invite_token を使う（conflict 時は1回目のトークン＝実際に DB にある値）。
      invite_url: inviteUrl(baseUrl, staff.invite_token!),
    });
  }

  return NextResponse.redirect(
    new URL(`/manager/staff?created=${staff.id}`, baseUrl),
    { status: 303 },
  );
}
