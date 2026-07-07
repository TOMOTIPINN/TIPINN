import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE,
} from "@/lib/session";
import { verifyOAuthState } from "@/lib/oauth-state";

/**
 * GET /api/auth/line/callback
 * LINEからのリダイレクトを受ける。state(署名付きJWT)を検証して returnTo/nonce を取り出し、
 * 認可コードをトークンに交換、id_token を LINE の verify で検証（署名・aud・exp・nonce）。
 * 得た line_user_id / display_name で customers を upsert し、署名付きセッションCookieを発行して
 * returnTo（＝招待 /staff/join?token=… 等）へ戻す。
 *
 * ★ 連結情報(returnTo/nonce)は cookie ではなく state から取り出す（cookie 非依存・
 *   標準カメラ→別ブラウザ復帰でも token が生き残る）。state cookie は「残っていれば」
 *   一致を確認してブラウザ束縛（CSRF）を追加で効かせる多層防御に留める。
 */
const TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
const VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";

/**
 * 失敗はホームへ。分かっている場合は returnTo を付けて戻すことで、ホームの
 * 「LINEではじめる」から復帰できるようにする（token 文脈を落とさない）。
 */
function fail(
  baseUrl: string,
  reason: string,
  detail?: unknown,
  returnTo?: string,
) {
  // TODO(echo): login=error の原因特定用の一時ログ。安定したら削除する
  console.error(`[line-callback] login=${reason}`, detail ?? "");
  const url = new URL(`/?login=${reason}`, baseUrl);
  if (returnTo && returnTo !== "/") url.searchParams.set("returnTo", returnTo);
  return NextResponse.redirect(url);
}

function clearHandshake(res: NextResponse) {
  res.cookies.set("line_oauth_state", "", { path: "/", maxAge: 0 });
}

export async function GET(request: Request) {
  const baseUrl = process.env.APP_BASE_URL!;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // ユーザーが同意画面でキャンセル等
  if (url.searchParams.get("error")) {
    const res = fail(baseUrl, "cancelled", {
      error: url.searchParams.get("error"),
      description: url.searchParams.get("error_description"),
    });
    clearHandshake(res);
    return res;
  }

  // state を検証（署名＋exp）。cookie 非依存に returnTo/nonce を取り出す。
  const parsed = await verifyOAuthState(state);
  if (!code || !parsed) {
    const res = fail(baseUrl, "error", {
      step: "state",
      hasCode: !!code,
      hasState: !!state,
      stateValid: !!parsed,
    });
    clearHandshake(res);
    return res;
  }
  const { returnTo, nonce } = parsed;

  // defense-in-depth: 同一ブラウザで state cookie が残っていれば一致を要求（CSRF ブラウザ束縛）。
  //   cookie が消えている（標準カメラ→別ブラウザ復帰）ときは署名+exp のみで通す。
  const store = await cookies();
  const cookieState = store.get("line_oauth_state")?.value;
  if (cookieState && cookieState !== state) {
    const res = fail(baseUrl, "error", { step: "state_binding" }, returnTo);
    clearHandshake(res);
    return res;
  }

  const channelId = process.env.LINE_CHANNEL_ID!;
  const channelSecret = process.env.LINE_CHANNEL_SECRET!;
  const redirectUri = `${baseUrl}/api/auth/line/callback`;

  // 1. 認可コード → トークン交換（機密クライアント＝client_secret が主防御。PKCE なし）
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: channelId,
      client_secret: channelSecret,
    }),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    const res = fail(
      baseUrl,
      "error",
      { step: "token", status: tokenRes.status, body },
      returnTo,
    );
    clearHandshake(res);
    return res;
  }
  const tokens = (await tokenRes.json()) as { id_token?: string };
  if (!tokens.id_token) {
    const res = fail(baseUrl, "error", { step: "no_id_token", tokens }, returnTo);
    clearHandshake(res);
    return res;
  }

  // 2. id_token を LINE で検証（署名・aud・exp・nonce を一括検証）。nonce は state 由来。
  const verifyRes = await fetch(VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      id_token: tokens.id_token,
      client_id: channelId,
      nonce,
    }),
  });
  if (!verifyRes.ok) {
    const body = await verifyRes.text();
    const res = fail(
      baseUrl,
      "error",
      { step: "verify", status: verifyRes.status, body },
      returnTo,
    );
    clearHandshake(res);
    return res;
  }
  const profile = (await verifyRes.json()) as { sub?: string; name?: string };
  if (!profile.sub) {
    const res = fail(baseUrl, "error", { step: "no_sub", profile }, returnTo);
    clearHandshake(res);
    return res;
  }

  // 3. customers を確保（line_user_id で一意）。service role = RLSバイパス。
  //    ★ display_name は「挿入時のみ」セットし、既存行は上書きしない（本人が /onboarding/name で
  //      確定した表示名や name_confirmed_at を、再ログインの度に LINE 名で潰さないため）。
  //    ON CONFLICT DO NOTHING（ignoreDuplicates）で挿入 → 常に select で行を取得（レース安全）。
  const { error: insErr } = await supabaseAdmin.from("customers").upsert(
    { line_user_id: profile.sub, display_name: profile.name ?? "" },
    { onConflict: "line_user_id", ignoreDuplicates: true },
  );
  if (insErr) {
    const res = fail(baseUrl, "error", { step: "upsert", error: insErr }, returnTo);
    clearHandshake(res);
    return res;
  }
  const { data: customer, error } = await supabaseAdmin
    .from("customers")
    .select("id, line_user_id")
    .eq("line_user_id", profile.sub)
    .single();

  if (error || !customer) {
    const res = fail(baseUrl, "error", { step: "select", error }, returnTo);
    clearHandshake(res);
    return res;
  }

  // 4. セッションCookie発行 → returnTo（招待 join 等）へ
  const token = await createSessionToken({
    customer_id: customer.id,
    line_user_id: customer.line_user_id,
  });

  const res = NextResponse.redirect(new URL(returnTo, baseUrl));
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  clearHandshake(res);
  return res;
}
