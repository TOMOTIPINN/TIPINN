import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

/**
 * セッション = customer_id を含む署名付きJWTを httpOnly Cookie に保存する。
 * DBセッションテーブルは持たない（8テーブルの原則を崩さない）。
 * 検証はサーバー（Route Handler / Server Component）でのみ行う。
 */
export const SESSION_COOKIE_NAME = "echo_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30日（秒）

const secret = new TextEncoder().encode(process.env.SESSION_SECRET!);

export type SessionPayload = {
  customer_id: string;
  line_user_id: string;
};

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secret);
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    const customer_id = payload.customer_id;
    const line_user_id = payload.line_user_id;
    if (typeof customer_id !== "string" || typeof line_user_id !== "string") return null;
    return { customer_id, line_user_id };
  } catch {
    return null;
  }
}

/** 現在のリクエストのセッションを読む（未ログインなら null） */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
