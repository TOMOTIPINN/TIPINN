import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminApi } from "@/lib/admin-guard";
import {
  normalizeOrganizationName,
  validateOrganizationName,
} from "@/lib/organization-name";

/**
 * POST /api/admin/organizations — 組織の新規作成（echo Labs 運営者のみ・§21 コミット5b・migration 0048）。
 *   入力: name（必須・屋号でも会社名でもよい・§21「2026-10-01 決定」）
 *   処理: 組織名を検証 → 前後の空白を除いて同じ名前が無いことを確認 → organizations に1行 INSERT。
 *
 * 認可: requireAdminApi（非運営者・未ログイン・env未設定は **404**。403 は返さない＝
 *   運営画面の存在を伏せる。@/lib/admin-guard 参照）。**画面側の isAdmin とは別に、ここで必ず確かめる。**
 *
 * ★重複はアプリ側で断る★（2026-10-01 決定）
 *   organizations.name に unique は無い（DB は変えない）。組織は数件しかないので全件の名前を引き、
 *   前後の空白を除いた形どうしで比べる。運営者しか使わないので、同時作成で重複が生まれる余地は考えない。
 *
 * オーナーはここでは登録しない（オーナー招待＝5d/5e で行う・§8.1 2026-09-24 更新）。
 *
 * 応答: フォーム送信 → /admin/organizations?created=1 へ 303。
 *   ★ID も名前も URL に載せない★（`50_security.md` §5 囲みA・§5-7 と同じ抜けを作らない。
 *   名前を載せると、作った URL で好きな文言を画面に出させられる）。
 */
export const runtime = "nodejs";

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

  const checked = validateOrganizationName(form.get("name"));
  if (!checked.ok) return back(`error=${checked.error}`);
  const name = checked.name;

  const { data: existing, error: listError } = await supabaseAdmin
    .from("organizations")
    .select("name");

  if (listError) {
    console.error("[admin/organizations] organizations の取得に失敗:", {
      code: listError.code,
    });
    return back("error=save");
  }

  const duplicated = ((existing ?? []) as { name: string }[]).some(
    (o) => normalizeOrganizationName(o.name) === name,
  );
  if (duplicated) return back("error=duplicate");

  const { error } = await supabaseAdmin.from("organizations").insert({ name });

  if (error) {
    console.error("[admin/organizations] insert failed:", { code: error.code });
    return back("error=save");
  }

  return back("created=1");
}
