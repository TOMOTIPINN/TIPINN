import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireManager } from "@/lib/manager-guard";

/**
 * POST /api/manager/staff/delete — スタッフの物理削除（hard delete・誤登録の重複を消す用）
 *   入力: staffId（form-data か JSON）。salon_id はクライアントから受け取らない（セッション由来）。
 *
 * 棲み分け: 実在スタッフの退職は archive（論理削除・実績保持）。ここは「誤登録の重複」など
 *   実績が一切無いスタッフだけを消すための hard delete。
 *
 * ★guard（厚め・サーバーが権威）:
 *   実行直前に reviews / rating_purchases を staff_id + salon_id で再カウントし、
 *   どちらか > 0 なら削除しない（has_reviews / has_purchases を 409 で返す）。
 *   クライアントのモーダルは表示用の事前判定にすぎず、実際の禁止はここで担保する。
 *   （reviews.staff_id / rating_purchases.staff_id は on delete set null のため FK では止まらない＝
 *     アプリ側でガードしないと実績の attribution が黙って null 化してしまう。）
 *   stamp_adjustments.created_by/updated_by も set null になるが、これは削除を止める理由にはしない
 *   （誤登録スタッフが訂正操作をしている記録は通常無い）。監査記録が消える旨はモーダル文言で告知。
 *
 * 認可: requireManager（未ログイン401 / 非manager403）＋ .eq(salon_id, ctx.salon_id) で越境拒否。
 * 応答: JSON→JSON / フォーム→ /manager/staff?deleted=1 へ303。
 */
export async function POST(req: Request) {
  const gate = await requireManager();
  if (!gate.ok) return gate.res;
  const { ctx } = gate;
  const baseUrl = process.env.APP_BASE_URL!;

  const isJson = (req.headers.get("content-type") ?? "").includes(
    "application/json",
  );

  let idRaw: unknown;
  if (isJson) {
    const body = await req.json().catch(() => null);
    idRaw = body?.staffId;
  } else {
    const form = await req.formData().catch(() => null);
    idRaw = form?.get("staffId");
  }

  const staffId = typeof idRaw === "string" ? idRaw : "";
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

  // 実行直前の再カウント（サーバー権威の guard）。
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

  if ((reviewCount ?? 0) > 0) {
    return NextResponse.json(
      { error: "has_reviews", review_count: reviewCount ?? 0 },
      { status: 409 },
    );
  }
  if ((purchaseCount ?? 0) > 0) {
    return NextResponse.json(
      { error: "has_purchases", purchase_count: purchaseCount ?? 0 },
      { status: 409 },
    );
  }

  const { error } = await supabaseAdmin
    .from("staff")
    .delete()
    .eq("id", staffId)
    .eq("salon_id", ctx.salon_id);

  if (error) {
    console.error("staff delete failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  if (isJson) {
    return NextResponse.json({ ok: true, staff_id: staffId });
  }
  return NextResponse.redirect(new URL("/manager/staff?deleted=1", baseUrl), {
    status: 303,
  });
}
