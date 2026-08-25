import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

/**
 * echo Labs 運営者（プラットフォーム管理者）のガード。
 *
 * 「運営者かどうか」は **env `ADMIN_LINE_USER_IDS`（カンマ区切り）だけ**で決める。
 * DB には持たない＝ staff.role には一切触らない（サロン側のロール体系と混ぜない）。
 * サロンの店長(manager)は自店の管理者であって echo Labs の運営者ではない。
 *
 * ★不許可は 403 ではなく **404** を返す★
 *   403 は「そのURLは存在する」というオラクルになる。運営画面の存在自体を伏せるため、
 *   未ログイン・非運営者・env 未設定のすべてを 404（ページは notFound()）で畳む。
 *   /staff/received/[reviewId] が他人の評価を 404 で伏せているのと同じ作法。
 *
 * fail closed: env 未設定・空文字なら **全員が非運営者**（誤って全開放しない）。
 */

/** env をパースして line_user_id の集合を返す。未設定なら空集合＝誰も通さない。 */
export function adminLineUserIds(): Set<string> {
  const raw = process.env.ADMIN_LINE_USER_IDS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

/** 現在のセッションが運営者か。未ログイン・env未設定は false。 */
export async function isAdmin(): Promise<boolean> {
  const ids = adminLineUserIds();
  if (ids.size === 0) {
    // 設定漏れは「全開放」ではなく「全閉」。運用ミスで管理画面が野ざらしになるのを防ぐ。
    console.warn("[admin-guard] ADMIN_LINE_USER_IDS が未設定です（全員を非運営者として扱います）");
    return false;
  }
  const session = await getSession();
  if (!session?.line_user_id) return false;
  return ids.has(session.line_user_id);
}

/**
 * 管理 API 用。非運営者には **404 の JSON** を返す（403 と区別しない）。
 * 成功時は運営者の line_user_id を返す（発行者の記録に使う）。
 */
export async function requireAdminApi(): Promise<
  { ok: true; lineUserId: string } | { ok: false; res: NextResponse }
> {
  const notFound = {
    ok: false as const,
    res: NextResponse.json({ error: "not_found" }, { status: 404 }),
  };

  const ids = adminLineUserIds();
  if (ids.size === 0) return notFound;

  const session = await getSession();
  if (!session?.line_user_id) return notFound;
  if (!ids.has(session.line_user_id)) return notFound;

  return { ok: true, lineUserId: session.line_user_id };
}
