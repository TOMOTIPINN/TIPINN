import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { resolveInvite } from "@/lib/staff-invite";
import { isThrottled, recordAttempt } from "@/lib/login-attempts";
import { notifyRateLimitHit } from "@/lib/security-alert";

/**
 * POST /api/staff/bind  （認証方式B / [[auth-method-line-b]]）
 * 招待トークンを消費して、ログイン中の line_user_id を staff 行に紐付ける（権威の処理）。
 *   form: token=<invite_token>, publish_consent=on
 *
 * 紐付けは「新しい ID/PW を作らない」前提：本人は LINE ログイン済み（=セッションの line_user_id）。
 * 書き込みは service_role・サーバー側のみ（RLS deny-by-default は変更しない）。
 *
 * ★公開同意（migration 0045）★
 *   氏名・肩書・紹介文・写真が顧客に表示されることへの同意を、**本人**がここで行う。
 *   店長には本人に代わって許諾する権限がないため、店長の申告は許諾にならない
 *   （弁護士見解・docs/40_decisions.md §10）。この route が唯一の記録地点。
 *   ・明示的な true 以外は **400（consent_required）**。検証は **どの書き込みより前**に置く
 *     （recordAttempt も staff の UPDATE も通さない）。/staff/join のボタン disabled は
 *     UI の補助にすぎず、curl・JS 無効・改変クライアントでも必ずここで止まる。
 *   ・confirmed_by は **クライアントから受け取らない**。紐付けできた staff 行自身の id
 *     （DB が返した値）を使う。
 *   ・**既に confirmed_at が入っている行は上書きしない**（.is(...,null) ガード）。
 *     店長申告方式だった期間に作られた行の記録日時を、受諾日時で塗り替えないため。
 *   ・この2列は**記録であって公開の制御ではない**。顧客側の表示条件は従来どおり
 *     salon_id 一致 ＋ archived_at is null のみ＝同意が無くても表示は止めない。
 *
 * 成功 → /staff へ 303 リダイレクト。失敗 → /staff/join?token=…&error=理由 へ戻す。
 */
function redirect(baseUrl: string, path: string) {
  return NextResponse.redirect(new URL(path, baseUrl), { status: 303 });
}

export async function POST(req: Request) {
  const baseUrl = process.env.APP_BASE_URL!;

  // レート制限（0037）: 同一IPの招待トークン総当たりを止める。既存の認証判定には触れない。
  if (await isThrottled(req, "staff_bind")) {
    // 運営者へ通知（設問6・不正アクセス検知）。例外を投げない実装なので 429 は不変。
    await notifyRateLimitHit(req, "staff_bind");
    return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
  }

  const session = await getSession();
  // 未ログインなら、戻り先を join に固定して LINE ログインへ。
  const form = await req.formData().catch(() => null);
  const token = (form?.get("token") as string | null) ?? null;

  if (!session?.line_user_id) {
    const back = `/staff/join${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    return redirect(
      baseUrl,
      `/api/auth/line/login?returnTo=${encodeURIComponent(back)}`,
    );
  }

  // 公開同意（0045）。**明示的な true 以外はすべて拒否**（欠落・false・空文字・"0" を含む）。
  // checkbox は checked のときだけ "on" を送る＝未チェックはキー自体が来ない（undefined で弾く）。
  // ★位置★ resolveInvite / recordAttempt / staff の UPDATE の **どれよりも前**に置く。
  //   後ろに置くと、同意なしのリクエストでも login_attempts に行が増え、
  //   最悪 staff を紐付けてから拒否することになる。
  if (!isConsentGiven(form?.get("publish_consent"))) {
    return NextResponse.json({ error: "consent_required" }, { status: 400 });
  }

  const result = await resolveInvite(token, session.line_user_id);
  if (!result.ok) {
    // reason は missing/not_found/expired/already_used/line_taken の分類語（token は入れない）。
    await recordAttempt(req, "staff_bind", false, result.reason);
    const q = token ? `?token=${encodeURIComponent(token)}&` : "?";
    return redirect(baseUrl, `/staff/join${q}error=${result.reason}`);
  }

  // 競合ガード: invite_token 一致かつ未紐付けの行のみ更新（同時実行の二重紐付け防止）。
  const { data: updated, error } = await supabaseAdmin
    .from("staff")
    .update({
      line_user_id: session.line_user_id,
      bound_at: new Date().toISOString(),
      invite_token: null,
      invite_expires_at: null,
    })
    .eq("invite_token", token!)
    .is("line_user_id", null)
    // publish_consent_confirmed_at はこの UPDATE では触らないので、返るのは現在値
    // ＝「既に記録があるか」をもう1回 SELECT せずに判定できる。
    .select("id, publish_consent_confirmed_at")
    .maybeSingle();

  if (error || !updated) {
    console.error("staff bind failed:", error);
    await recordAttempt(req, "staff_bind", false, "bind_conflict");
    const q = token ? `?token=${encodeURIComponent(token)}&` : "?";
    return redirect(baseUrl, `/staff/join${q}error=not_found`);
  }

  await recordConsent(updated.id, updated.publish_consent_confirmed_at);

  await recordAttempt(req, "staff_bind", true);
  return redirect(baseUrl, "/staff");
}

/**
 * 本人の同意を staff 行に記録する（0045）。紐付けが成功した**後**に呼ぶ。
 *
 * ・confirmed_by は行自身の id。クライアントの申告ではなく、UPDATE が返した値を使う。
 * ・`.is("publish_consent_confirmed_at", null)` で二重にガードし、既存の記録を上書きしない
 *   （呼び出し側でも current を見て弾いているが、ここだけ見ても安全なようにしておく）。
 * ・**失敗しても bind は成功のまま**にする。行は既に紐付いており、ここで 500 に倒すと
 *   本人が /staff に入れないまま「参加する」を押し直すことになる（再送しても
 *   line_user_id が埋まっているので二度と通らない）。記録の欠落は console.error で残す。
 */
async function recordConsent(
  staffId: string,
  currentConfirmedAt: string | null,
): Promise<void> {
  // 既に記録がある行（店長申告方式だった期間に作られた行など）は触らない。
  if (currentConfirmedAt) return;

  const { error } = await supabaseAdmin
    .from("staff")
    .update({
      publish_consent_confirmed_at: new Date().toISOString(),
      publish_consent_confirmed_by: staffId,
    })
    .eq("id", staffId)
    .is("publish_consent_confirmed_at", null);

  if (error) {
    console.error("[staff/bind] ★公開同意の記録に失敗（紐付けは成功）", {
      staff_id: staffId,
      error,
    });
  }
}

/**
 * 公開同意の申告を厳格に判定する（0045）。
 *
 * **true と判定するのは明示的な肯定値のみ**。欠落（null）・false・"false"・"0"・空文字は
 * すべて false ＝ 400 になる。緩めて「値があれば true」にすると、欠落だけを弾いて
 * false を通してしまう。
 * checkbox は checked のとき "on" を送るため、これを肯定値として受ける。
 */
function isConsentGiven(value: FormDataEntryValue | null | undefined): boolean {
  if (typeof value !== "string") return false;
  return value === "on" || value === "true" || value === "1";
}
