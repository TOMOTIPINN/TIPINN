import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getVisitContext } from "@/lib/visit-context";
import { getStaffContext } from "@/lib/staff-session";
import { getMigrationEntry } from "@/lib/stamp-adjustments";
import { computeVipProgress } from "@/lib/vip";

/**
 * POST /api/staff/visit — 店頭の来店受付（QR読み取り／来店スライス1 / [[auth-method-line-b]]）。
 *
 * お客様提示のQR（中身＝customer_id 生UUID）を読み、
 * ①lookup: 確認カード用にお客様名・累計来店回数・VIP状態、および移行の状態を返す
 * ②record: submit_visit_and_earn_stamp を呼び本日の来店を記録（1日1回はRPC側で冪等担保）
 * ③migrate: 旧LINEショップカードの残高を移行台帳（stamp_adjustments）へ入力/訂正
 * を行う。salon スコープは常に vctx.salon_id（自店のみ）。書き込みは supabaseAdmin・サーバー側のみ。
 *
 * 認可: getVisitContext() で解決（2経路）。未認証→401。
 *   ・スタッフ経路: LINEログイン中で staff に紐付く人（role 問わず＝一般スタッフも受付・移行可）。
 *   ・端末経路: LINE無しでも有効な device_token cookie を持つ据え置き端末（記録は匿名）。
 * 移行の入力・訂正は在籍staff/端末いずれも可（ロール判定なし）。created_by/updated_by は追跡用に保持するだけ。
 * ¥は一切扱わない（来店軸は無料・無決済・原則5/6）。QRの中身は今回 customer_id 素のまま（動的トークンは別タスク）。
 * 累計は COUNT(visits)+SUM(migration delta) の1式（0019・lib/stamp-adjustments と同じ定義）。
 */
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Body = { action?: unknown; customer_id?: unknown; delta?: unknown };

export async function POST(req: Request): Promise<NextResponse> {
  // ガード: スタッフ経路 or 端末経路のいずれかで salon スコープを解決（どちらも無ければ未認証）。
  const vctx = await getVisitContext();
  if (!vctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
    // 確認カード用: お客様名・このサロンの累計来店回数・VIP（感想軸）・移行の状態。
    const [
      { data: customer },
      visitCountRes,
      { data: earned },
      { data: salon },
      migration,
    ] = await Promise.all([
      supabaseAdmin
        .from("customers")
        .select("display_name")
        .eq("id", customerId)
        .maybeSingle(),
      supabaseAdmin
        .from("visits")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", customerId)
        .eq("salon_id", vctx.salon_id),
      supabaseAdmin
        .from("earned_stamps")
        .select("count")
        .eq("customer_id", customerId)
        .eq("salon_id", vctx.salon_id)
        .maybeSingle(),
      supabaseAdmin
        .from("salons")
        .select("visit_cycle_size")
        .eq("id", vctx.salon_id)
        .maybeSingle<{ visit_cycle_size: number }>(),
      getMigrationEntry(customerId, vctx.salon_id),
    ]);

    if (!customer) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    // VIPは感想軸（earned_stamps.count）から。金額・順位は一切扱わない（原則5）。
    const vip = computeVipProgress(earned?.count ?? 0);
    const migrationDelta = migration?.delta ?? 0;

    // 「旧カード残数を訂正」ボタンの表示ゲート。
    // 旧カード残数は移行時に一度確定する値で、訂正が要るのは入力ミスに気づく初回付近だけ。
    // 移行後 visit（実来店）が2回以下のときだけ訂正ボタンを出し、3回目以降は隠す（画面のノイズ低減）。
    // 基準は初回移行時刻（migration.createdAt・訂正の UPDATE では不変・0019）。移行当日の
    // チェックイン（migrate→record 連続実行）も created_at が移行より後になり #1 としてカウントする。
    let migrationCorrectable = false;
    if (migration) {
      const { count: postMigrationVisits } = await supabaseAdmin
        .from("visits")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", customerId)
        .eq("salon_id", vctx.salon_id)
        .gt("created_at", migration.createdAt);
      migrationCorrectable = (postMigrationVisits ?? 0) <= 2;
    }

    return NextResponse.json({
      name: customer.display_name,
      // 累計は実来店 + 移行オフセット（1式一本化）。
      visitCount: (visitCountRes.count ?? 0) + migrationDelta,
      isVIP: vip.isVIP,
      // 移行UI用: 未移行なら入力欄、既移行なら訂正欄（在籍staff/端末いずれも可）。
      migrated: migration !== null,
      migrationDelta,
      // 訂正ボタンを出してよいか（移行後 visit <= 2）。未移行時は無関係（false）。
      migrationCorrectable,
      cycleSize: salon?.visit_cycle_size ?? 20,
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

    // 1日1回・JST基準・累計はRPC側(0009/0019)で担保。2回目以降も awarded=false で正常返却（エラーにしない）。
    const { data, error } = await supabaseAdmin.rpc(
      "submit_visit_and_earn_stamp",
      { p_customer_id: customerId, p_salon_id: vctx.salon_id },
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

  if (action === "migrate") {
    // 旧カード残高の入力(新規)/訂正。在籍staff・端末いずれも可（ロール判定なし）。
    // created_by/updated_by は「誰が入力・訂正したか」の追跡用に保持するだけ（操作は止めない）。
    const deltaRaw = body?.delta;
    const deltaNum =
      typeof deltaRaw === "number" ? deltaRaw : Number(deltaRaw);
    if (!Number.isInteger(deltaNum)) {
      return NextResponse.json({ error: "invalid_delta" }, { status: 400 });
    }

    // 対象顧客の存在確認。
    const { data: customer } = await supabaseAdmin
      .from("customers")
      .select("id")
      .eq("id", customerId)
      .maybeSingle();
    if (!customer) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    // クランプ範囲 = 0〜そのサロンのハードル値（visit_cycle_size）。範囲外は弾く。
    const { data: salon } = await supabaseAdmin
      .from("salons")
      .select("visit_cycle_size")
      .eq("id", vctx.salon_id)
      .maybeSingle<{ visit_cycle_size: number }>();
    const cycleSize = salon?.visit_cycle_size ?? 20;
    if (deltaNum < 0 || deltaNum > cycleSize) {
      return NextResponse.json(
        { error: "out_of_range", max: cycleSize },
        { status: 400 },
      );
    }

    // 操作者（在籍staff）。端末経路は個人特定不可のため null（匿名）。権限には使わず追跡のみ。
    const staffCtx = await getStaffContext();
    const operatorId = staffCtx?.staff_id ?? null;
    const nowIso = new Date().toISOString();

    // 未移行→INSERT / 既移行→UPDATE（誰でも可）。created_by は初回のみ、updated_by は訂正時に更新。
    const existing = await getMigrationEntry(customerId, vctx.salon_id);
    if (existing) {
      const { error } = await supabaseAdmin
        .from("stamp_adjustments")
        .update({ delta: deltaNum, updated_by: operatorId, updated_at: nowIso })
        .eq("id", existing.id);
      if (error) {
        console.error("stamp_adjustments update failed:", error);
        return NextResponse.json({ error: "migrate_failed" }, { status: 500 });
      }
    } else {
      const { error } = await supabaseAdmin.from("stamp_adjustments").insert({
        customer_id: customerId,
        salon_id: vctx.salon_id,
        delta: deltaNum,
        source: "migration",
        created_by: operatorId,
        updated_by: operatorId,
      });
      if (error) {
        console.error("stamp_adjustments insert failed:", error);
        return NextResponse.json({ error: "migrate_failed" }, { status: 500 });
      }
    }

    // 更新後の合算累計（実来店 + 移行delta）を返し、確認カードを即更新できるようにする。
    const { count } = await supabaseAdmin
      .from("visits")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId)
      .eq("salon_id", vctx.salon_id);
    return NextResponse.json({
      migrated: true,
      migrationDelta: deltaNum,
      visitCount: (count ?? 0) + deltaNum,
    });
  }

  return NextResponse.json({ error: "bad_action" }, { status: 400 });
}
