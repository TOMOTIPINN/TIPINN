import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * スタッフ招待トークンの発行＋検証（認証方式B / [[auth-method-line-b]]）。
 * 店長が発行した staff.invite_token を、ログイン中の line_user_id に紐付ける前に検証する。
 * 発行（A1 管理画面・/api/manager/staff）と検証（/staff/join・/api/staff/bind）の単一ソース。
 *
 * 全クエリ service_role・サーバー側のみ。line_user_id は PII（原則7）。
 */

/** 招待の有効期限：24時間（A1 要件）。 */
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

/** URLセーフな招待トークンを生成（login route と同じ crypto.randomBytes + base64url）。 */
export function createInviteToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** 発行時点から24時間後の ISO 文字列（invite_expires_at 用）。 */
export function inviteExpiryISO(nowMs: number = Date.now()): string {
  return new Date(nowMs + INVITE_TTL_MS).toISOString();
}

/** 招待URL（既存 Step4 導線 /staff/join にそのまま繋がる）。 */
export function inviteUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/staff/join?token=${encodeURIComponent(token)}`;
}

/** 招待が有効（トークンあり＆未期限切れ）か。now は既定で現在時刻（純度違反を lib 側に閉じ込める）。 */
export function isInviteActive(
  token: string | null,
  expiresISO: string | null,
  nowMs: number = Date.now(),
): boolean {
  return !!token && !!expiresISO && new Date(expiresISO).getTime() > nowMs;
}

/** 招待の残り時間（時間・切り上げ・下限0）。表示用。 */
export function inviteRemainingHours(
  expiresISO: string,
  nowMs: number = Date.now(),
): number {
  return Math.max(0, Math.ceil((new Date(expiresISO).getTime() - nowMs) / 3_600_000));
}
export type InviteStaff = {
  id: string;
  name: string;
  salon_id: string;
  salon_name: string;
  role: string;
};

export type InviteResult =
  | { ok: true; staff: InviteStaff }
  | {
      ok: false;
      reason: "missing" | "not_found" | "expired" | "already_used" | "line_taken";
    };

type Row = {
  id: string;
  name: string;
  salon_id: string;
  role: string;
  line_user_id: string | null;
  invite_expires_at: string | null;
  salons: { name: string } | { name: string }[] | null;
};

function one<T>(v: T | T[] | null): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/**
 * token と「これから紐付ける line_user_id」を渡して検証する。
 * - missing: token が無い
 * - not_found: 該当 staff 無し
 * - already_used: 既に誰かに紐付け済み（token は消費後 null になる想定だが二重ガード）
 * - expired: 有効期限切れ
 * - line_taken: その LINE は既に別の staff に紐付いている（1 LINE = 最大1 staff）
 */
export async function resolveInvite(
  token: string | null | undefined,
  lineUserId: string,
): Promise<InviteResult> {
  if (!token) return { ok: false, reason: "missing" };

  const { data } = await supabaseAdmin
    .from("staff")
    .select(
      "id, name, salon_id, role, line_user_id, invite_expires_at, salons(name)",
    )
    .eq("invite_token", token)
    .maybeSingle();

  const row = data as Row | null;
  if (!row) return { ok: false, reason: "not_found" };
  if (row.line_user_id) return { ok: false, reason: "already_used" };
  if (
    row.invite_expires_at &&
    new Date(row.invite_expires_at).getTime() < Date.now()
  ) {
    return { ok: false, reason: "expired" };
  }

  // この LINE が既に別の staff に紐付いていないか（unique 制約の手前で親切に弾く）。
  const { data: existing } = await supabaseAdmin
    .from("staff")
    .select("id")
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  if (existing && existing.id !== row.id) {
    return { ok: false, reason: "line_taken" };
  }

  return {
    ok: true,
    staff: {
      id: row.id,
      name: row.name,
      salon_id: row.salon_id,
      salon_name: one(row.salons)?.name ?? "",
      role: row.role,
    },
  };
}

/** 検証 NG の理由 → 顧客向けの温かい日本語メッセージ。 */
export function inviteReasonMessage(reason: string): string {
  switch (reason) {
    case "missing":
      return "招待リンクが正しくありません。";
    case "not_found":
      return "この招待は見つかりませんでした。店長に再発行を依頼してください。";
    case "expired":
      return "招待の有効期限が切れています。店長に再発行を依頼してください。";
    case "already_used":
      return "この招待はすでに使用されています。";
    case "line_taken":
      return "このLINEアカウントは、すでに別のスタッフに紐付いています。";
    default:
      return "招待を確認できませんでした。";
  }
}
