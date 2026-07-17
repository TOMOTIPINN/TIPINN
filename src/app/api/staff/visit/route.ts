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

type Body = {
  action?: unknown;
  customer_id?: unknown;
  delta?: unknown;
  reward_id?: unknown;
};

/**
 * done 画面の消費型特典まわりの状態（record / redeem / void がこの同じ形を返す）。
 *  ・availableRewards … 本日この来店で消せる候補（0027）
 *  ・todaysRedemption … 本日この来店で消込済みの1件（0030・get_todays_redemption）／無ければ null
 * この2つは排他（0027 は本日消込済みなら0行を返す）。TS側で排他を作り直さず、両RPCの結果をそのまま渡す。
 * cycle_axis/cycle_index は帳簿上の概念でUIに出さないため、todaysRedemption は title だけに絞って返す。
 */
type ConsumableDoneState = {
  availableRewards: { rewardId: string; title: string }[];
  todaysRedemption: { title: string } | null;
};

/**
 * 消費型特典の done 状態を読み直す。record 後・redeem 後・void 後の共通の返り値ソース。
 * どちらのRPCが失敗しても done 画面自体は壊さない（来店/消込/取消は既に永続化済み・表示の欠落は機会損失止まり）。
 */
async function buildConsumableDoneState(
  customerId: string,
  salonId: string,
): Promise<ConsumableDoneState> {
  const [availRes, todayRes] = await Promise.all([
    supabaseAdmin.rpc("list_available_consumable_rewards", {
      p_customer_id: customerId,
      p_salon_id: salonId,
    }),
    supabaseAdmin.rpc("get_todays_redemption", {
      p_customer_id: customerId,
      p_salon_id: salonId,
    }),
  ]);

  let availableRewards: { rewardId: string; title: string }[] = [];
  if (availRes.error) {
    console.error("list_available_consumable_rewards failed:", availRes.error);
  } else {
    availableRewards = ((availRes.data ?? []) as {
      reward_id: string;
      title: string;
    }[]).map((row) => ({ rewardId: row.reward_id, title: row.title }));
  }

  let todaysRedemption: { title: string } | null = null;
  if (todayRes.error) {
    console.error("get_todays_redemption failed:", todayRes.error);
  } else {
    const row = (
      Array.isArray(todayRes.data) ? todayRes.data[0] : todayRes.data
    ) as { title: string } | null | undefined;
    todaysRedemption = row ? { title: row.title } : null;
  }

  return { availableRewards, todaysRedemption };
}

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

    // 消費型特典の done 状態（本日消せる候補＋本日消込済みの1件）を提示（消し忘れ→別スタッフの再提供を防ぐ）。
    // ⚠️ 来店は上で既に永続化済み。この状態取得が失敗しても record は成功として返す
    // （特典が出ないのは機会損失だが、来店が記録されない方が遥かに重い）。buildConsumableDoneState 内で吸収。
    // ⚠️ awarded（本日初回スタンプ）とは独立。awarded=false（本日2回目のスキャン＝朝チェックイン後の
    // 施術後SPA提供など）でも候補は出うるため、if (awarded) で囲まない。
    const doneState = await buildConsumableDoneState(customerId, vctx.salon_id);

    return NextResponse.json({
      name: customer.display_name,
      awarded: r?.stamp_awarded === true,
      newCount: r?.new_count ?? 0,
      ...doneState,
    });
  }

  if (action === "redeem") {
    // 消費型特典の消込（record 後、スタッフが「ご褒美SPA」等を実際に提供したときにチェックを外す）。
    // 消込は record 後にしか起こらない＝confirm/lookup では判定できないため、この action で単独処理する。
    const rewardId =
      typeof body?.reward_id === "string" ? body.reward_id.trim() : "";
    if (!UUID_RE.test(rewardId)) {
      return NextResponse.json({ error: "invalid_reward" }, { status: 400 });
    }

    // 操作者（在籍staff）。端末経路は個人特定不可のため null（stamp_adjustments.created_by と同じ割り切り）。
    const staffCtx = await getStaffContext();
    const staffId = staffCtx?.staff_id ?? null;

    // 消込は 0028 に一元化（本日来店の有無・二重消込・サイクル導出を RPC 側で原子的に判定）。
    const { data, error } = await supabaseAdmin.rpc("redeem_reward", {
      p_customer_id: customerId,
      p_salon_id: vctx.salon_id,
      p_reward_id: rewardId,
      p_staff_id: staffId,
    });
    // DB障害等（RPC 例外）は 500。業務上の失敗は例外でなく ok=false で返る（下で 409）。
    if (error) {
      console.error("redeem_reward failed:", error);
      return NextResponse.json({ error: "redeem_failed" }, { status: 500 });
    }

    const r = (Array.isArray(data) ? data[0] : data) as {
      ok: boolean;
      reason: string | null;
    } | null;
    // 業務上の失敗（no_visit_today / no_available_reward / already_redeemed_today）は
    // reason をそのまま 409 で返す（客/端末を責めず、UI 側で文言分岐する）。
    if (r?.ok !== true) {
      return NextResponse.json(
        { error: r?.reason ?? "no_available_reward" },
        { status: 409 },
      );
    }
    // 成功。done 状態を読み直して返す（クライアントは redeemedTitle 等の独自形を持たず、この状態で再描画）。
    const doneState = await buildConsumableDoneState(customerId, vctx.salon_id);
    return NextResponse.json({ ok: true, ...doneState });
  }

  if (action === "void") {
    // 消込の取消（押し間違い・提供の取りやめ）。done 画面の「取り消す」から呼ぶ。
    // 本日来店の有無・取消対象の有無は 0030 の RPC 側で判定（TS で軸/サイクルを再計算しない）。
    // 操作者は redeem と同経路。端末（kiosk）経路は個人特定不可のため null（仕様どおり）。
    const staffCtx = await getStaffContext();
    const staffId = staffCtx?.staff_id ?? null;

    const { data, error } = await supabaseAdmin.rpc("void_reward_redemption", {
      p_customer_id: customerId,
      p_salon_id: vctx.salon_id,
      p_staff_id: staffId,
    });
    // DB障害等（RPC 例外）は 500。業務上の失敗は例外でなく ok=false で返る（下で 409）。
    if (error) {
      console.error("void_reward_redemption failed:", error);
      return NextResponse.json({ error: "void_failed" }, { status: 500 });
    }

    const r = (Array.isArray(data) ? data[0] : data) as {
      ok: boolean;
      reason: string | null;
    } | null;
    // 業務上の失敗（no_visit_today / nothing_to_void）は reason をそのまま 409 で返す（UI で文言分岐）。
    if (r?.ok !== true) {
      return NextResponse.json(
        { error: r?.reason ?? "nothing_to_void" },
        { status: 409 },
      );
    }
    // 成功。done 状態を読み直して返す（取消後は候補が復活し、自然に「使う」二択へ戻る）。
    const doneState = await buildConsumableDoneState(customerId, vctx.salon_id);
    return NextResponse.json({ ok: true, ...doneState });
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
