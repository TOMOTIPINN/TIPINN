import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * サロン作成の招待コード（migration 0043 `public.salon_invites`）の発行・検証・消費。
 *
 * 発行は /admin/invites（echo Labs 運営者のみ）、消費は /api/manager/salon/new。
 * 「有効なコードを持っている人だけがサロンを作れる」を成立させる単一ソース。
 *
 * 全クエリ service_role・サーバー側のみ。コードは「持っていればサロンを作れる」秘密値なので、
 * ログ・エラーメッセージ・通知に**生のコードを出さない**（login_attempts.detail と同じ方針）。
 */

/** 招待の有効期限：14日。復旧（/admin/invites）でも同じ長さだけ延長する。 */
export const SALON_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** コード長（正規化後・ハイフンなし）。 */
const CODE_LEN = 12;

/**
 * Crockford Base32。紛らわしい I / L / O / U を含まない32文字。
 * 32 は 256 の約数なので、randomBytes の1バイトを % 32 してもモジュロ偏りが出ない。
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 招待コードを生成する（正規化済み・ハイフンなしの12文字）。 */
export function createInviteCode(): string {
  const bytes = crypto.randomBytes(CODE_LEN);
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[bytes[i] % 32];
  return out;
}

/**
 * 人が入力したコードを DB の保存形へ正規化する。
 * 小文字・ハイフン・空白を吸収し、Crockford の慣例に沿って読み違えを救済する
 * （I/L→1, O→0, U→V）。アルファベット外の文字は落とす。
 */
export function normalizeInviteCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[ILil]/g, "1")
    .replace(/[Oo]/g, "0")
    .replace(/[Uu]/g, "V")
    .split("")
    .filter((c) => ALPHABET.includes(c))
    .join("");
}

/** 表示用に 4文字ずつハイフンで区切る（XXXX-XXXX-XXXX）。 */
export function formatInviteCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, "$1-");
}

/** 発行時点から14日後の ISO 文字列。 */
export function inviteExpiryISO(nowMs: number = Date.now()): string {
  return new Date(nowMs + SALON_INVITE_TTL_MS).toISOString();
}

export type InviteState = "usable" | "used" | "expired";

/** 行の状態を1箇所で決める（一覧表示と検証で判定がズレないように）。 */
export function inviteState(
  row: { used_at: string | null; expires_at: string },
  nowMs: number = Date.now(),
): InviteState {
  if (row.used_at) return "used";
  if (new Date(row.expires_at).getTime() <= nowMs) return "expired";
  return "usable";
}

export type CheckResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "not_found" | "used" | "expired" };

/**
 * コードの事前チェック（**消費はしない**）。入力エラーを親切に出し分けるためだけに使う。
 * 実際の可否は consumeInvite の条件付き UPDATE が決める（下の注意を参照）。
 */
export async function checkInviteCode(
  rawCode: string | null | undefined,
): Promise<CheckResult> {
  if (!rawCode) return { ok: false, reason: "missing" };
  const code = normalizeInviteCode(rawCode);
  if (code.length !== CODE_LEN) return { ok: false, reason: "not_found" };

  const { data } = await supabaseAdmin
    .from("salon_invites")
    .select("used_at, expires_at")
    .eq("code", code)
    .maybeSingle<{ used_at: string | null; expires_at: string }>();

  if (!data) return { ok: false, reason: "not_found" };
  const state = inviteState(data);
  if (state === "used") return { ok: false, reason: "used" };
  if (state === "expired") return { ok: false, reason: "expired" };
  return { ok: true };
}

/**
 * 招待を消費する（**原子的**）。salons へ INSERT し終えた後に呼ぶこと。
 *
 * ★ここが二重消費を防ぐ唯一の点★
 *   「未使用かつ期限内」を WHERE に載せた単一の UPDATE で、更新できた行数で成否を決める。
 *   SELECT で確認してから UPDATE すると、その間に別リクエストが同じコードを消費でき、
 *   1つの招待から2サロンが作れてしまう。checkInviteCode の結果は信用しない。
 *
 * salon_id は FK で salons を参照するため、salons INSERT より前には呼べない。
 *
 * @returns 消費できたら true。false なら「先を越された / 期限切れ / 使用済み」。
 */
export async function consumeInvite(
  rawCode: string,
  salonId: string,
): Promise<boolean> {
  const code = normalizeInviteCode(rawCode);
  if (code.length !== CODE_LEN) return false;

  const { data, error } = await supabaseAdmin
    .from("salon_invites")
    .update({ used_at: new Date().toISOString(), salon_id: salonId })
    .eq("code", code)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id");

  if (error) {
    console.error("[salon-invite] consume failed:", error);
    return false;
  }
  return !!data && data.length === 1;
}

/** 検証 NG の理由 → 画面に出す日本語。生のコードは含めない。 */
export function inviteReasonMessage(reason: string): string {
  switch (reason) {
    case "missing":
      return "招待コードを入力してください。";
    case "used":
      return "この招待コードはすでに使用されています。";
    case "expired":
      return "この招待コードは有効期限が切れています。発行元にご連絡ください。";
    case "not_found":
    default:
      return "招待コードが正しくありません。";
  }
}
