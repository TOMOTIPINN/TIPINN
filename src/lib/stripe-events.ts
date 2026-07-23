import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Stripe webhook の冪等化（migration 0032 stripe_events）共通ロジック。
 *
 * Connect 用（/api/stripe/webhook/connect）と platform 用（/api/stripe/webhook）の
 * 両ルートが同じ冪等記録を使う。二重配信での二重課金・二重消込を最上位で止めるのが目的。
 *   - claimStripeEvent: 署名検証済みイベントを (id, type, salon_id, payload) で記録し、
 *     新規/再試行/処理済みを判定する。
 *   - markStripeEventProcessed: 実処理の正常終了を processed_at に刻む（以後の再送を弾く印）。
 */

export type EventClaim = "claimed" | "retry" | "already_processed";

/**
 * 冪等の第一層（0032 stripe_events）。署名検証済みイベントを (id, type, salon_id, payload) で記録する。
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
        payload: event as unknown as Record<string, unknown>,
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
