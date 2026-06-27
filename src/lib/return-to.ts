/**
 * ログイン後の戻り先（returnTo）の検証（CLAUDE.md §8・QR導線）。
 *
 * オープンリダイレクト対策: 受け取った値は「自サイト内のローカルパス」のみ許可する。
 *   外部URL（http://… / //evil.com / /\evil.com 等）は拒否し "/" にフォールバック。
 * login（保存時）と callback（遷移時）の両方で必ず通す。
 */
const SAFE_FALLBACK = "/";

export function sanitizeReturnTo(value: string | null | undefined): string {
  if (typeof value !== "string" || value.length === 0) return SAFE_FALLBACK;
  // 必ず "/" 始まり、かつ "//" や "/\"（プロトコル相対・バックスラッシュ）でないこと。
  if (!value.startsWith("/")) return SAFE_FALLBACK;
  if (value.startsWith("//") || value.startsWith("/\\")) return SAFE_FALLBACK;
  // 制御文字混入を弾く。
  if (/[\x00-\x1f]/.test(value)) return SAFE_FALLBACK;
  return value;
}
