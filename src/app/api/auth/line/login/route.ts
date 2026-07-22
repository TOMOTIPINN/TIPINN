import { NextResponse } from "next/server";
import crypto from "crypto";
import { sanitizeReturnTo } from "@/lib/return-to";
import { createOAuthState } from "@/lib/oauth-state";

/**
 * GET /api/auth/line/login
 * LINEログインの開始点。`?returnTo=<ローカルパス>` を受け取り、CSRF対策の state と
 * リプレイ対策の nonce を生成する。
 *
 * ★ state は returnTo(招待token) と nonce を封入した署名付きJWT（@/lib/oauth-state）。
 *   これにより往復の連結情報が URL 側に載り、標準カメラ→別ブラウザ復帰で cookie が
 *   消えても token が生き残る（cookie 非依存・[[auth-method-line-b]]）。
 *   state の cookie コピーは「同一ブラウザでのブラウザ束縛（CSRF）」の多層防御としてのみ使う。
 *
 * ※ PKCE は廃止。本クライアントは機密クライアント（LINE_CHANNEL_SECRET をサーバー保持し
 *   token 交換で提示）で、code は単回・登録済 redirect_uri 限定配送のため主防御は client_secret。
 *   PKCE の code_verifier は秘匿値ゆえ state に載せられず、cookie 依存の唯一の残存要因だったため外す。
 */
const AUTHORIZE_URL = "https://access.line.me/oauth2/v2.1/authorize";
const STATE_COOKIE_MAX_AGE = 600; // 10分（state 本体の exp と一致）

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export async function GET(request: Request) {
  const channelId = process.env.LINE_CHANNEL_ID!;
  const baseUrl = process.env.APP_BASE_URL!;
  const redirectUri = `${baseUrl}/api/auth/line/callback`;
  const returnTo = sanitizeReturnTo(
    new URL(request.url).searchParams.get("returnTo"),
  );

  // nonce: id_token リプレイ対策。state に封入して cookie 非依存にし、callback で LINE verify に渡す。
  const nonce = b64url(crypto.randomBytes(32));
  // state: returnTo(token) + nonce を封入した署名付きJWT（改ざん=署名／リプレイ=exp）。
  const state = await createOAuthState(returnTo, nonce);

  const authorizeUrl = new URL(AUTHORIZE_URL);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", channelId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("scope", "openid profile");
  authorizeUrl.searchParams.set("nonce", nonce);

  // 同意画面で echo 公式アカウントの友だち追加を促す導線:
  //   ・店頭オンボーディング（returnTo=/onboard…）＝顧客（follow は /api/line/webhook が
  //     customers.line_is_friend へ同期）。
  //   ・スタッフ招待（returnTo=/staff/join…）＝スタッフ。PWA アイコンを失っても公式アカウントを
  //     恒久的な入口として残すため、招待→ログイン時にも友だち追加を促す。
  // いずれも「促す」だけで必須化しない（未追加でもスタッフ登録・利用は成立）。bot_prompt は authorize
  // 時のみ効くパラメータで callback は無関与。scope は openid profile のまま（bot_prompt に追加 scope 不要）。
  // 他導線（returnTo が上記以外）のログインには付けない＝既存挙動を変えない。
  if (returnTo.startsWith("/onboard") || returnTo.startsWith("/staff/join")) {
    authorizeUrl.searchParams.set("bot_prompt", "aggressive");
  }

  const res = NextResponse.redirect(authorizeUrl);
  // defense-in-depth: 同一ブラウザで cookie が生き残る通常フローでは、callback が state と
  //   突き合わせてブラウザ束縛（CSRF）を効かせる。cookie が消える経路では署名+exp で担保する。
  res.cookies.set("line_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: STATE_COOKIE_MAX_AGE,
  });
  return res;
}
