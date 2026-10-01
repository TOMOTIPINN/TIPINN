/**
 * 組織名（`public.organizations.name`・migration 0048）の正規化と検証。
 *
 * 作成（/api/admin/organizations・§21 コミット5b）と、組織名の修正（5c）で同じ規則を使うために分けている。
 * 組織の単位は事業者（契約主体）なので、契約書の事業者名をそのまま入れる前提
 * （§21「2026-09-24 決定」1）。表記の揺れ（「株式会社」の位置など）は直さない。
 *
 * 規則（2026-10-01 決定・§21 5b）:
 *   ・前後の空白（全角を含む）を除く。中の空白はそのまま
 *   ・空は不可
 *   ・100文字まで（コードポイントで数える）
 *   ・改行などの制御文字は不可
 *   重複の確認は DB を引く必要があるので、ここではなく呼び出し側で行う
 *   （DB に unique は無い。アプリ側で「前後の空白を除いて同じ名前」を断る）。
 */

/** 組織名の上限（文字数）。 */
export const ORGANIZATION_NAME_MAX = 100;

export type OrganizationNameError = "name_empty" | "name_long" | "name_invalid";

export type OrganizationNameResult =
  | { ok: true; name: string }
  | { ok: false; error: OrganizationNameError };

/** 前後の空白を除いた形。重複の比較もこの形どうしで行う。 */
export function normalizeOrganizationName(input: string): string {
  // String.prototype.trim は全角スペース（U+3000）も除く。
  return input.trim();
}

/** 入力を検証し、保存する形の組織名を返す。 */
export function validateOrganizationName(
  input: unknown,
): OrganizationNameResult {
  if (typeof input !== "string") return { ok: false, error: "name_empty" };

  const name = normalizeOrganizationName(input);
  if (name.length === 0) return { ok: false, error: "name_empty" };

  if (/[\u0000-\u001f\u007f]/.test(name)) {
    return { ok: false, error: "name_invalid" };
  }

  if ([...name].length > ORGANIZATION_NAME_MAX) {
    return { ok: false, error: "name_long" };
  }

  return { ok: true, name };
}
