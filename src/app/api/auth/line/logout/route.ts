import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/session";

/**
 * POST /api/auth/line/logout
 * セッションCookieを破棄してホームへ戻す。
 */
export async function POST() {
  const baseUrl = process.env.APP_BASE_URL!;
  const res = NextResponse.redirect(new URL("/", baseUrl), { status: 303 });
  res.cookies.set(SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return res;
}
