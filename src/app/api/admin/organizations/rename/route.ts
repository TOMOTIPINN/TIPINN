import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminApi } from "@/lib/admin-guard";
import {
  normalizeOrganizationName,
  validateOrganizationName,
} from "@/lib/organization-name";

/**
 * POST /api/admin/organizations/rename — 組織名の修正（echo Labs 運営者のみ・§21 コミット5c）。
 *   入力（**POST の本文**）: id（組織の uuid）／ name（新しい組織名）
 *   処理: id の形 → 名前の検証（organization-name.ts・5b と同じ規則）→ 全組織を引いて id の実在 →
 *         変わっていないか → 自分以外との重複 → UPDATE（1行だったかを確かめる）。
 *   応答: 成功 → /admin/organizations?updated=1 へ 303。失敗 → ?error=<分類語> へ 303。
 *
 * 認可: requireAdminApi（非運営者・未ログイン・env未設定は **404**）。画面側の isAdmin とは別に必ず確かめる。
 *
 * ★ID も名前も戻り先の URL に載せない★（5b と同じ・`50_security.md` §5 囲みA・§5-7）。
 * ★id の形が不正でも、存在しなくても同じ error=id★（違いを応答に出さない）。
 * ★名前が変わっていないときは書き込まない★（error=unchanged・2026-10-01 決定）。
 *   前後の空白だけの違いは、揃えた形で比べるので「変わっていない」になる。
 * ★重複は「自分以外の組織に、揃えた形で同じ名前があるか」★（DB に unique は無い・5b と同じ）。
 * ★更新した行数を確かめる★ 0行なら error=save（存在しない ID でも成功扱いにしない・§5-7）。
 *
 * 変更の記録（前の名前）は残さない（2026-10-01 決定）。ログには error.code だけを出す。
 */
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.res;

  const baseUrl = process.env.APP_BASE_URL!;
  const back = (qs: string) =>
    NextResponse.redirect(new URL(`/admin/organizations?${qs}`, baseUrl), {
      status: 303,
    });

  const form = await req.formData().catch(() => null);
  if (!form) return back("error=form");

  const idRaw = form.get("id");
  const id = typeof idRaw === "string" ? idRaw.trim() : "";
  if (!UUID_RE.test(id)) return back("error=id");

  const checked = validateOrganizationName(form.get("name"));
  if (!checked.ok) return back(`error=${checked.error}`);
  const name = checked.name;

  const { data: orgs, error: listError } = await supabaseAdmin
    .from("organizations")
    .select("id, name");

  if (listError) {
    console.error("[admin/organizations/rename] organizations の取得に失敗:", {
      code: listError.code,
    });
    return back("error=save");
  }

  const rows = (orgs ?? []) as { id: string; name: string }[];
  const self = rows.find((o) => o.id === id);
  if (!self) return back("error=id");

  if (normalizeOrganizationName(self.name) === name) return back("error=unchanged");

  const duplicated = rows.some(
    (o) => o.id !== id && normalizeOrganizationName(o.name) === name,
  );
  if (duplicated) return back("error=duplicate");

  const { data: updatedRows, error } = await supabaseAdmin
    .from("organizations")
    .update({ name })
    .eq("id", id)
    .select("id");

  if (error) {
    console.error("[admin/organizations/rename] update failed:", {
      code: error.code,
    });
    return back("error=save");
  }
  if (!updatedRows || updatedRows.length !== 1) return back("error=save");

  return back("updated=1");
}
