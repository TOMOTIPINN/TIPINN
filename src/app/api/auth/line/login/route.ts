import { NextResponse } from "next/server";
import crypto from "crypto";

/**
 * GET /api/auth/line/login
 * LINEログインの開始点。CSRF対策の state、リプレイ対策の nonce、PKCE の
 * code_verifier を生成して短命Cookieに保存し、LINE認可エンドポイントへリダイレクト。
 */
const AUTHORIZE_URL = "https://access.line.me/oauth2/v2.1/authorize";
const HANDSHAKE_MAX_AGE = 600; // 10分

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export async function GET() {
  const channelId = process.env.LINE_CHANNEL_ID!;
  const baseUrl = process.env.APP_BASE_URL!;
  const redirectUri = `${baseUrl}/api/auth/line/callback`;

  const state = b64url(crypto.randomBytes(32));
  const nonce = b64url(crypto.randomBytes(32));
  const codeVerifier = b64url(crypto.randomBytes(32));
  const codeChallenge = b64url(
    crypto.createHash("sha256").update(codeVerifier).digest(),
  );

  const authorizeUrl = new URL(AUTHORIZE_URL);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", channelId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("scope", "openid profile");
  authorizeUrl.searchParams.set("nonce", nonce);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  const res = NextResponse.redirect(authorizeUrl);
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: HANDSHAKE_MAX_AGE,
  };
  res.cookies.set("line_oauth_state", state, opts);
  res.cookies.set("line_oauth_nonce", nonce, opts);
  res.cookies.set("line_oauth_verifier", codeVerifier, opts);
  return res;
}
