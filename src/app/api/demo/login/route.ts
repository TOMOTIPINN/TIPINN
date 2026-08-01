import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE,
} from "@/lib/session";
import {
  DEMO_PERSONAS,
  DEMO_SALON_ID,
  DEMO_LINE_PREFIX,
  isDemoLoginEnabled,
  verifyDemoKey,
  type DemoPersonaKey,
} from "@/lib/demo";
import { isThrottled, recordAttempt } from "@/lib/login-attempts";

/**
 * POST /api/demo/login — 営業デモ用ログインバイパス（本番Prodでは無効・Previewのみ）。
 *
 * LINE 往復を飛ばし、デモ persona（customer / staff）の echo_session を発行する。
 * 受け取るのは body の { as, key } のみ。ID は一切受け取らない（@/lib/demo の定数が正）。
 *
 * ★フェイルクローズ：あらゆる失敗（無効・鍵不一致・不正as・DB不整合・例外）は
 *   すべて 404 で統一する。401/403 も使わず、エンドポイントの存在自体を隠す。
 *   本文に内部構造を出さない（内訳はサーバーログのみ）。
 */
export const runtime = "nodejs"; // node:crypto（定数時間比較）を使うため

/** 失敗はすべてこれ。存在を隠すため 404・本文なし・情報を返さない。 */
function notFound(): NextResponse {
  return new NextResponse(null, { status: 404 });
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    // ゲート1: env 二重ゲート（本番Prod は未設定＝ここで必ず 404）。
    if (!isDemoLoginEnabled()) return notFound();

    // レート制限（0037）: 共有鍵の総当たりを止める。失敗も既存4ゲートと同じ 404 に統一。
    // ★ゲート1の後に置く: 本番Prod は env 未設定で必ずここに来ないため、無効な環境で
    //   未認証リクエストごとに DB を引かせない（しかも記録が無い＝しきい値に永遠に達しない）。
    if (await isThrottled(req, "demo_login")) return notFound();

    // body 取得（HTMLフォームの x-www-form-urlencoded / multipart 両対応）。
    let as: string | null = null;
    let key: string | null = null;
    try {
      const form = await req.formData();
      const rawAs = form.get("as");
      const rawKey = form.get("key");
      as = typeof rawAs === "string" ? rawAs : null;
      key = typeof rawKey === "string" ? rawKey : null;
    } catch {
      return notFound();
    }

    // ゲート2: シークレット（定数時間比較）。不一致は 404。
    if (!verifyDemoKey(key)) {
      // 鍵そのものは絶対に残さない（分類語のみ）。
      await recordAttempt(req, "demo_login", false, "key_mismatch");
      return notFound();
    }

    // ゲート3: as は enum のみ。persona はサーバー定数から引く（入力IDは受けない）。
    if (as !== "customer" && as !== "staff" && as !== "manager") {
      return notFound();
    }
    const persona = DEMO_PERSONAS[as as DemoPersonaKey];

    // ゲート4（多層防御・実DB照合）: デモsalon 以外へ絶対に到達させない。
    if (as === "staff" || as === "manager") {
      // staff/manager persona: line_user_id に一致する staff が「デモsalon所属」であることを確認。
      // role の区別はここでは不要（店長ガードは /manager/* 側の ctx.role で担う）。
      const { data: staff } = await supabaseAdmin
        .from("staff")
        .select("id, salon_id")
        .eq("line_user_id", persona.line_user_id)
        .maybeSingle();
      if (!staff || staff.salon_id !== DEMO_SALON_ID) return notFound();
    } else {
      // 顧客 persona: 固定 customer_id の行が存在し、line_user_id がデモ接頭辞であること。
      const { data: customer } = await supabaseAdmin
        .from("customers")
        .select("id, line_user_id")
        .eq("id", persona.customer_id)
        .maybeSingle();
      if (
        !customer ||
        customer.line_user_id !== persona.line_user_id ||
        !customer.line_user_id.startsWith(DEMO_LINE_PREFIX)
      ) {
        return notFound();
      }
    }

    await recordAttempt(req, "demo_login", true);

    // セッション発行（LINE成功時と同一の作法を再利用）。
    const token = await createSessionToken({
      customer_id: persona.customer_id,
      line_user_id: persona.line_user_id,
    });

    // リダイレクト先は persona.redirectTo（/mypage・/staff の相対パス）を
    // リクエスト元(req.url)基準で解決する＝実際に開いているホスト（Preview/携帯）に追従。
    // APP_BASE_URL（localhost等になり得る）には依存しない。
    const res = NextResponse.redirect(new URL(persona.redirectTo, req.url), {
      status: 303, // POST → GET リダイレクト
    });
    res.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return res;
  } catch (e) {
    // 例外も 404 に潰す（500でスタックや存在を漏らさない）。内訳はログのみ。
    console.error("[demo-login] failed", e);
    return notFound();
  }
}

// POST 以外のメソッドも 404 に統一し、存在と許可メソッドを漏らさない
// （App Router 既定の 405 + Allow ヘッダを使わない＝エンドポイントの存在を隠す）。
export const GET = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const HEAD = notFound;
export const OPTIONS = notFound;
