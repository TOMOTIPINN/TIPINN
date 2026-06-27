import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";

/**
 * POST /api/manager/visibility
 * 店長Inbox（画面マップ11）のキュレーション: reviews.visibility を 'all' | 'manager' に更新。
 *   body: { reviewId: string, visibility: 'all' | 'manager' }
 *
 * 書き込みは共有 supabaseAdmin（service_role）でサーバー側のみ（RLS deny-by-default・CLAUDE.md §8）。
 * ※ visibility は share_scope（顧客の希望）とは別の「店長の判断」。migration 0006 で追加。
 *
 * 認証（方式B / [[auth-method-line-b]]）:
 *   ・未ログイン → 401
 *   ・スタッフ未紐付け / role!=='manager' → 403
 *   ・更新は **自サロン（ctx.salon_id）のレビューのみ**にスコープ（越境更新を物理的に拒否）。
 *     他サロン or 存在しない reviewId は 0 件更新 → 404。
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ctx = await getStaffContext();
  if (!ctx || ctx.role !== "manager") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let payload: { reviewId?: unknown; visibility?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { reviewId, visibility } = payload;
  if (typeof reviewId !== "string" || !reviewId) {
    return NextResponse.json({ error: "missing_review_id" }, { status: 400 });
  }
  if (visibility !== "all" && visibility !== "manager") {
    return NextResponse.json({ error: "invalid_visibility" }, { status: 400 });
  }

  // 自サロンのレビューに限定して更新。返り行が無ければ越境/不存在として 404。
  const { data, error } = await supabaseAdmin
    .from("reviews")
    .update({ visibility })
    .eq("id", reviewId)
    .eq("salon_id", ctx.salon_id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("visibility update failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, visibility });
}
