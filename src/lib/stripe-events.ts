import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Stripe webhook の冪等化（migration 0032 stripe_events）共通ロジック。
 *
 * Connect 用（/api/stripe/webhook/connect）と platform 用（/api/stripe/webhook）の
 * 両ルートが同じ冪等記録を使う。二重配信での二重課金・二重消込を最上位で止めるのが目的。
 *   - claimStripeEvent: 署名検証済みイベントを (id, type, salon_id, 絞り込み済み payload) で
 *     記録し、新規/再試行/処理済みを判定する。payload は redactEventPayload() で最小化する
 *     （購入者の個人情報は保存しない）。
 *   - markStripeEventProcessed: 実処理の正常終了を processed_at に刻む（以後の再送を弾く印）。
 */

export type EventClaim = "claimed" | "retry" | "already_processed";

/**
 * stripe_events.payload に保存する最小形。
 *
 * 目的: 冪等化（id 突合）と障害調査（種別・金額・決済状態・metadata）に要る項目だけを残し、
 *   購入者の個人情報を echo の DB に持ち込まない。
 *   保存しないもの: customer_details / customer / shipping / billing_details / charges /
 *   individual / business_profile / company、および data.previous_attributes。
 *
 * ★許可リスト方式にする理由★
 *   イベント種別ごとに data.object の型が違い、Stripe 側の項目追加も止められない。
 *   「消す」実装だと新しい PII 項目が素通りするため、「拾う項目を明示する」側に倒す。
 *
 * ★data.previous_attributes を保存しない理由★
 *   *.updated では変更前の値がそのまま入る＝ customer_details / individual 等が
 *   別の経路で戻ってくる。ここを開けると絞り込みの意味が無くなる。
 */
type RedactedEventPayload = {
  id: string;
  type: string;
  created: number;
  /** test/live の判別（調査時に本番イベントかどうかを最初に見るため）。 */
  livemode?: boolean;
  account: string | null;
  object: {
    id?: string;
    amount_total?: number;
    currency?: string;
    payment_status?: string;
    payment_intent?: string;
    metadata?: Record<string, string>;
    /** account.updated の審査状態（PII ではない。どこで止まっているかの調査用）。 */
    details_submitted?: boolean;
    charges_enabled?: boolean;
    payouts_enabled?: boolean;
  };
};

/** 型が一致するときだけ拾う（イベント種別ごとに列の有無が違うため undefined を許す）。 */
function pickString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function pickNumber(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}
function pickBoolean(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

/**
 * 署名検証済みイベントを、保存してよい最小形に絞り込む。
 * undefined のキーは JSON 化で落ちるため、種別に無い項目は保存 JSON に現れない。
 */
export function redactEventPayload(event: Stripe.Event): RedactedEventPayload {
  // data.object は種別ごとに別型。許可リストで拾うので unknown 経由で扱う。
  const o = (event.data?.object ?? {}) as unknown as Record<string, unknown>;

  // payment_intent は string | PaymentIntent（expand 時）。**必ず ID だけ**に畳む。
  // オブジェクトのまま保存すると charges[].billing_details から PII が戻る。
  const pi = o.payment_intent;
  const paymentIntent =
    typeof pi === "string"
      ? pi
      : pickString((pi as { id?: unknown } | null | undefined)?.id);

  // metadata は echo 自身が /api/checkout で載せた値
  // （customer_id / salon_id / staff_id / tier / amount）。文字列値のみ通す。
  const meta = o.metadata;
  const metadata =
    meta && typeof meta === "object"
      ? Object.fromEntries(
          // filter だけでは値の型が unknown のままなので、flatMap で [string, string] に絞る。
          Object.entries(meta as Record<string, unknown>).flatMap(([k, v]) =>
            typeof v === "string" ? [[k, v] as [string, string]] : [],
          ),
        )
      : undefined;

  return {
    id: event.id,
    type: event.type,
    created: event.created,
    livemode: pickBoolean(event.livemode),
    account: event.account ?? null,
    object: {
      id: pickString(o.id),
      amount_total: pickNumber(o.amount_total),
      currency: pickString(o.currency),
      payment_status: pickString(o.payment_status),
      payment_intent: paymentIntent,
      metadata,
      details_submitted: pickBoolean(o.details_submitted),
      charges_enabled: pickBoolean(o.charges_enabled),
      payouts_enabled: pickBoolean(o.payouts_enabled),
    },
  };
}

/**
 * 冪等の第一層（0032 stripe_events）。署名検証済みイベントを
 * (id, type, salon_id, 絞り込み済み payload) で記録する。
 * payload は redactEventPayload() で最小化してから保存する（PII 非保存）。
 *   - 新規挿入できた → "claimed"
 *   - 衝突（既受信）かつ処理完了(processed_at NOT NULL) → "already_processed"（実処理を弾く）
 *   - 衝突（既受信）だが未処理(processed_at IS NULL・前回の途中失敗) → "retry"（実処理を再実行）
 * INSERT/SELECT が失敗したら throw（呼び出し側が 500 で Stripe に再送させる）。
 *
 * @param salonId Connect 側は event.account から解決した salon_id を渡す（解決不能なら null）。
 *   platform 側は常に null。
 */
export async function claimStripeEvent(
  event: Stripe.Event,
  salonId: string | null = null,
): Promise<EventClaim> {
  // ON CONFLICT (id) DO NOTHING 相当。挿入できた行だけ返る（衝突時は空）。
  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("stripe_events")
    .upsert(
      {
        id: event.id,
        type: event.type,
        salon_id: salonId,
        // ★イベント全体を保存しない★ 購入者の個人情報（customer_details 等）を
        //   DB に持ち込まないため、許可リストで最小形に絞る（redactEventPayload）。
        payload: redactEventPayload(event),
      },
      { onConflict: "id", ignoreDuplicates: true },
    )
    .select("id");
  if (insErr) throw insErr;
  if ((inserted?.length ?? 0) > 0) return "claimed"; // 新規受信

  // 衝突＝既受信。処理済みかどうかで実処理をやり直すか弾くかを決める。
  const { data: existing, error: selErr } = await supabaseAdmin
    .from("stripe_events")
    .select("processed_at")
    .eq("id", event.id)
    .single();
  if (selErr) throw selErr;
  return existing?.processed_at ? "already_processed" : "retry";
}

/** 実処理の正常終了を stripe_events.processed_at に刻む（以後の再送を弾く印）。 */
export async function markStripeEventProcessed(eventId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("stripe_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("id", eventId);
  if (error) throw error;
}
