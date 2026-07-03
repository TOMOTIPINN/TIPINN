import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";
import { computeVipProgress } from "@/lib/vip";

/**
 * POST /api/staff/visit — 店頭の来店受付（QR読み取り／来店スライス1・LINE無し / [[auth-method-line-b]]）。
 *
 * スタッフ（staff/manager どちらでも）が、お客様提示のQR（中身＝customer_id 生UUID）を読み、
 * ①lookup: 確認カード用にお客様名・累計来店回数・VIP状態を返す
 * ②record: submit_visit_and_earn_stamp を呼び本日の来店を記録（1日1回はRPC側で冪等担保）
 * を行う。salon スコープは常に ctx.salon_id（自店のみ）。書き込みは supabaseAdmin・サーバー側のみ。
 *
 * 認可: 未ログイン→401／スタッフ未紐付け→403（requireManager と違い role は問わない＝一般スタッフも受付可）。
 * ¥は一切扱わない（来店軸は無料・無決済・原則5/6）。QRの中身は今回 customer_id 素のまま（動的トークンは別タスク）。
 */
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Body = { action?: unknown; customer_id?: unknown };

export async function POST(req: Request): Promise<NextResponse> {
  // ガード: ログイン必須 → スタッフ紐付け必須（role は問わない）。
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const ctx = await getStaffContext();
  if (!ctx) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Body | null;
  const action = body?.action;
  const customerId =
    typeof body?.customer_id === "string" ? body.customer_id.trim() : "";

  // QRの中身が customer_id の体裁（UUID）でなければ、読み取りミスとして弾く（RPCは呼ばない）。
  if (!UUID_RE.test(customerId)) {
    return NextResponse.json({ error: "invalid_qr" }, { status: 400 });
  }

  if (action === "lookup") {
    // 確認カード用: お客様名（display_name）・このサロンの累計来店回数・VIP（感想軸）。
    const [{ data: customer }, visitCountRes, { data: earned }] =
      await Promise.all([
        supabaseAdmin
          .from("customers")
          .select("display_name")
          .eq("id", customerId)
          .maybeSingle(),
        supabaseAdmin
          .from("visits")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", customerId)
          .eq("salon_id", ctx.salon_id),
        supabaseAdmin
          .from("earned_stamps")
          .select("count")
          .eq("customer_id", customerId)
          .eq("salon_id", ctx.salon_id)
          .maybeSingle(),
      ]);

    if (!customer) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    // VIPは感想軸（earned_stamps.count）から。金額・順位は一切扱わない（原則5）。
    const vip = computeVipProgress(earned?.count ?? 0);
    return NextResponse.json({
      name: customer.display_name,
      visitCount: visitCountRes.count ?? 0,
      isVIP: vip.isVIP,
    });
  }

  if (action === "record") {
    // 存在を明示確認（FK任せでもよいが、名前を返し・エラー文言を分けるため）。
    const { data: customer } = await supabaseAdmin
      .from("customers")
      .select("display_name")
      .eq("id", customerId)
      .maybeSingle();
    if (!customer) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    // 1日1回・JST基準・累計はRPC側(0009)で担保。2回目以降も awarded=false で正常返却（エラーにしない）。
    const { data, error } = await supabaseAdmin.rpc(
      "submit_visit_and_earn_stamp",
      { p_customer_id: customerId, p_salon_id: ctx.salon_id },
    );
    if (error) {
      console.error("submit_visit_and_earn_stamp failed:", error);
      return NextResponse.json({ error: "record_failed" }, { status: 500 });
    }

    const r = (Array.isArray(data) ? data[0] : data) as {
      new_count: number;
      stamp_awarded: boolean;
    } | null;
    return NextResponse.json({
      name: customer.display_name,
      awarded: r?.stamp_awarded === true,
      newCount: r?.new_count ?? 0,
    });
  }

  return NextResponse.json({ error: "bad_action" }, { status: 400 });
}
