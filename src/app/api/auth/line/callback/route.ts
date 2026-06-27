import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE,
} from "@/lib/session";
import { sanitizeReturnTo } from "@/lib/return-to";

/**
 * GET /api/auth/line/callback
 * LINEからのリダイレクトを受ける。state(CSRF)を検証し、認可コードをトークンに
 * 交換、id_token を LINE の verify エンドポイントで検証（署名・aud・exp・nonce）。
 * 得た line_user_id / display_name で customers を upsert（service role = RLSバイパス）し、
 * 署名付きセッションCookieを発行してホームへ戻す。
 */
const TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
const VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
const HANDSHAKE_COOKIES = [
  "line_oauth_state",
  "line_oauth_nonce",
  "line_oauth_verifier",
  "line_oauth_returnto",
];

function fail(baseUrl: string, reason: string, detail?: unknown) {
  // TODO(echo): login=error の原因特定用の一時ログ。安定したら削除する
  console.error(`[line-callback] login=${reason}`, detail ?? "");
  return NextResponse.redirect(new URL(`/?login=${reason}`, baseUrl));
}

function clearHandshake(res: NextResponse) {
  for (const name of HANDSHAKE_COOKIES) {
    res.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
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

  const store = await cookies();
  const savedState = store.get("line_oauth_state")?.value;
  const savedNonce = store.get("line_oauth_nonce")?.value;
  const verifier = store.get("line_oauth_verifier")?.value;
  // ログイン後の戻り先（login で保存・ローカルパスのみ。再検証して使う）。
  const returnTo = sanitizeReturnTo(store.get("line_oauth_returnto")?.value);

  // state(CSRF) と PKCE verifier の存在・一致を検証
  if (
    !code ||
    !state ||
    !savedState ||
    state !== savedState ||
    !savedNonce ||
    !verifier
  ) {
    const res = fail(baseUrl, "error", {
      step: "state",
      hasCode: !!code,
      hasState: !!state,
      hasSavedState: !!savedState,
      stateMatch: state === savedState,
      hasNonce: !!savedNonce,
      hasVerifier: !!verifier,
    });
    clearHandshake(res);
    return res;
  }

  const channelId = process.env.LINE_CHANNEL_ID!;
  const channelSecret = process.env.LINE_CHANNEL_SECRET!;
  const redirectUri = `${baseUrl}/api/auth/line/callback`;

  // 1. 認可コード → トークン交換
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: channelId,
      client_secret: channelSecret,
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    const res = fail(baseUrl, "error", {
      step: "token",
      status: tokenRes.status,
      body,
    });
    clearHandshake(res);
    return res;
  }
  const tokens = (await tokenRes.json()) as { id_token?: string };
  if (!tokens.id_token) {
    const res = fail(baseUrl, "error", { step: "no_id_token", tokens });
    clearHandshake(res);
    return res;
  }

  // 2. id_token を LINE で検証（署名・aud・exp・nonce を一括検証）
  const verifyRes = await fetch(VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      id_token: tokens.id_token,
      client_id: channelId,
      nonce: savedNonce,
    }),
  });
  if (!verifyRes.ok) {
    const body = await verifyRes.text();
    const res = fail(baseUrl, "error", {
      step: "verify",
      status: verifyRes.status,
      body,
    });
    clearHandshake(res);
    return res;
  }
  const profile = (await verifyRes.json()) as { sub?: string; name?: string };
  if (!profile.sub) {
    const res = fail(baseUrl, "error", { step: "no_sub", profile });
    clearHandshake(res);
    return res;
  }

  // 3. customers を upsert（line_user_id で一意）。service role = RLSバイパス
  const { data: customer, error } = await supabaseAdmin
    .from("customers")
    .upsert(
      { line_user_id: profile.sub, display_name: profile.name ?? "" },
      { onConflict: "line_user_id" },
    )
    .select("id, line_user_id")
    .single();

  if (error || !customer) {
    const res = fail(baseUrl, "error", { step: "upsert", error });
    clearHandshake(res);
    return res;
  }

  // 4. セッションCookie発行 → ホームへ
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
