import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireManager } from "@/lib/manager-guard";

/**
 * GET /api/manager/staff/counts?staffId=<uuid>
 *   スタッフに紐づく実績件数（reviews / rating_purchases）を返す。削除確認モーダルの表示用。
 *
 * 用途: hard delete は「感想も有償評価も 0 件」のときだけ許可する棲み分けの、UI 側の事前判定。
 *   ここは表示用（都度取得）で、実際の削除可否は delete API が実行直前に再カウントして権威判定する。
 * 認可: requireManager（未ログイン401 / 非manager403）＋ staff が自サロンのものか .eq(salon_id) で確認（越境拒否）。
 * カウントは head:true（行を返さない exact count）で軽量に。
 */
export async function GET(req: Request) {
  const gate = await requireManager();
  if (!gate.ok) return gate.res;
  const { ctx } = gate;

  const staffId = new URL(req.url).searchParams.get("staffId");
  if (!staffId) {
    return NextResponse.json({ error: "missing_staff_id" }, { status: 400 });
  }

  // 自サロンの staff か（他サロン / 不存在は 404）。
  const { data: staff } = await supabaseAdmin
    .from("staff")
    .select("id")
    .eq("id", staffId)
    .eq("salon_id", ctx.salon_id)
    .maybeSingle();
  if (!staff) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const [{ count: reviewCount }, { count: purchaseCount }] = await Promise.all([
    supabaseAdmin
      .from("reviews")
      .select("id", { count: "exact", head: true })
      .eq("staff_id", staffId)
      .eq("salon_id", ctx.salon_id),
    supabaseAdmin
      .from("rating_purchases")
      .select("id", { count: "exact", head: true })
      .eq("staff_id", staffId)
      .eq("salon_id", ctx.salon_id),
  ]);

  return NextResponse.json({
    review_count: reviewCount ?? 0,
    purchase_count: purchaseCount ?? 0,
  });
}
