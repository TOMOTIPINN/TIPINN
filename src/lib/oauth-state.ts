import { SignJWT, jwtVerify } from "jose";
import { sanitizeReturnTo } from "@/lib/return-to";

/**
 * LINEログインの `state` を「署名付き・自己完結トークン」にする（QR/招待導線・[[auth-method-line-b]]）。
 *
 * 背景: 従来 state / nonce / returnTo は httpOnly cookie に保存していたが、
 *   標準カメラ→Safari→LINEアプリの往復で cookie jar が分断され、callback で
 *   handshake cookie を失う → state 検証落ち → token(招待)が消えてホームに落ちる不具合があった。
 *
 * 対策: returnTo(招待token) と nonce を HS256 署名JWTに封入して state に載せる。
 *   - 改ざん: 署名（SESSION_SECRET）で防ぐ。callback 側でも sanitizeReturnTo を再適用（多層防御）。
 *   - リプレイ: exp（10分）で窓を最小化。jwtVerify が期限切れを自動で弾く。
 *   これで cookie が消えても URL の state だけで往復が完結する（cookie 非依存）。
 *
 * CSRF のブラウザ束縛は、cookie が残る通常フローでは呼び出し側が state cookie 一致で追加担保する
 * （cookie が消える経路では署名+exp のみで通す）。
 */
const secret = new TextEncoder().encode(process.env.SESSION_SECRET!);

/** state の有効期限（=リプレイ許容窓）。LINE 認可の往復に十分で、かつ短い。 */
export const OAUTH_STATE_TTL = "10m";

/** returnTo(招待token) と nonce を封入した署名付き state を作る。 */
export async function createOAuthState(
  returnTo: string,
  nonce: string,
): Promise<string> {
  return new SignJWT({ rt: returnTo, n: nonce })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(OAUTH_STATE_TTL)
    .sign(secret);
}

/**
 * state を検証して returnTo / nonce を取り出す。
 * 署名不正・期限切れ・型不正はすべて null（＝callback 側で login=error に畳む）。
 * returnTo は取り出し時にも sanitize（オープンリダイレクト対策の多層防御）。
 */
export async function verifyOAuthState(
  state: string | null | undefined,
): Promise<{ returnTo: string; nonce: string } | null> {
  if (!state) return null;
  try {
    const { payload } = await jwtVerify(state, secret);
    const rt = payload.rt;
    const n = payload.n;
    if (typeof rt !== "string" || typeof n !== "string") return null;
    return { returnTo: sanitizeReturnTo(rt), nonce: n };
  } catch {
    return null;
  }
}
