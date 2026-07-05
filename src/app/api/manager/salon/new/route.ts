import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";
import {
  SALON_ASSETS_BUCKET,
  validateImage,
  uploadPublicImage,
} from "@/lib/storage";

/**
 * POST /api/manager/salon/new — サロン・オンボーディング（Phase 1 / Stripe未接続 / [[auth-method-line-b]]）。
 *   入力: name（店名・必須）／logo（任意・form-data の File）／notify_after_minutes（任意・既定180）。
 *   処理: salon_id と visit_token をサーバー側で採番（crypto.randomUUID）→ ロゴがあれば
 *         salon-assets/salons/<salon_id>/logo に upsert → salons へ単一 INSERT。
 *         stripe_account_id は空のまま（Phase 2 で埋める）。
 *   自動登録: salons INSERT 成功後、作成者を新サロンの店長(role=manager)として staff に1行 INSERT。
 *
 * 認可（入口ゆるめ・page と同型）: 未ログイン→ログイン。staff行ゼロ(新規オーナー)は許可。
 *   既存staffは manager のみ許可（従業員は弾く）。他の /manager/* は従来どおり staff必須。
 *   書き込みは service_role・サーバー側のみ（§3・§8）。
 * 検証: 店名 trim＋長さ／通知遅延は DB CHECK と同値域(30〜360)にクランプ／画像は MIME(png/jpeg/webp)＋2MB。
 * 応答: フォーム送信 → /manager/salon/new?created=<salon_id>（成功・完了画面へ）/ ?error=<reason>（失敗）へ303。
 *
 * 注: 列名は salons.name（display_name 列は存在しない）。visit_token は既存行の hex 既定と形式が異なるが
 *     /visit は token 文字列一致で照合するため無害（randomUUID を採用）。
 */
export const runtime = "nodejs";

const NAME_MAX = 50;
const NOTIFY_MIN = 30;
const NOTIFY_MAX = 360;
const NOTIFY_DEFAULT = 180;

export async function POST(req: Request) {
  const baseUrl = process.env.APP_BASE_URL!;
  const back = (qs: string) =>
    NextResponse.redirect(new URL(`/manager/salon/new?${qs}`, baseUrl), {
      status: 303,
    });

  // 認可（入口ゆるめ・page と同型）: 未ログイン→ログイン（returnTo保持）。
  // staff行ゼロ(ctx=null)の新規オーナーは許可。既存staffは manager のみ許可（従業員は弾く）。
  const session = await getSession();
  if (!session?.line_user_id) {
    return NextResponse.redirect(
      new URL(
        `/api/auth/line/login?returnTo=${encodeURIComponent("/manager/salon/new")}`,
        baseUrl,
      ),
      { status: 303 },
    );
  }
  const ctx = await getStaffContext();
  if (ctx && ctx.role !== "manager") {
    return back("error=forbidden");
  }

  const form = await req.formData().catch(() => null);
  if (!form) return back("error=form");

  // 店名（必須）。trim して空・過長を弾く。
  const nameRaw = form.get("name");
  const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
  if (!name || name.length > NAME_MAX) return back("error=name");

  // 通知遅延（任意・既定180）。指定時は DB の CHECK(30〜360) と同じ値域に収める。
  let notify = NOTIFY_DEFAULT;
  const notifyRaw = form.get("notify_after_minutes");
  if (typeof notifyRaw === "string" && notifyRaw.trim() !== "") {
    const n = Number(notifyRaw);
    if (!Number.isFinite(n)) return back("error=notify");
    notify = Math.round(n);
    if (notify < NOTIFY_MIN || notify > NOTIFY_MAX) return back("error=notify");
  }

  // id と visit_token を先に採番する。こうすることでロゴパスに salon_id を使え、
  // INSERT を1回で完結できる（孤児ファイルなし・DB既定の上書き）。
  const salonId = randomUUID();
  const visitToken = randomUUID();

  // ロゴは任意。選択されているときだけ検証＋アップロードして logo_url を作る。
  let logoUrl: string | null = null;
  const fileValue = form.get("logo");
  const hasFile = fileValue instanceof File && fileValue.size > 0;
  if (hasFile) {
    const check = validateImage(fileValue);
    if (!check.ok) return back(`error=${check.error}`);

    const uploaded = await uploadPublicImage({
      bucket: SALON_ASSETS_BUCKET,
      path: `salons/${salonId}/logo`,
      file: check.file,
      contentType: check.contentType,
    });
    if (!uploaded.ok) return back("error=upload");

    // public URL は不変のため、CDN/ブラウザのキャッシュ回避に版数を付ける（A6と同作法）。
    logoUrl = `${uploaded.publicUrl}?v=${Date.now()}`;
  }

  const { error } = await supabaseAdmin.from("salons").insert({
    id: salonId,
    name,
    logo_url: logoUrl,
    visit_token: visitToken,
    notify_after_minutes: notify,
    // stripe_account_id は Phase 2 で接続時に埋める（ここでは未設定＝null）。
  });

  if (error) {
    console.error("salon onboarding insert failed:", error);
    return back("error=save");
  }

  // 作成者を新サロンの店長(role=manager)として自動登録（[[auth-method-line-b]]）。
  // 名前: 既存staffなら staff.name、staff行ゼロの新規オーナーは customers.display_name（LINEログインで必須設定）。
  let ownerName = ctx?.name ?? null;
  if (!ownerName) {
    const { data: cust } = await supabaseAdmin
      .from("customers")
      .select("display_name")
      .eq("line_user_id", session.line_user_id)
      .maybeSingle();
    ownerName = cust?.display_name ?? "オーナー";
  }

  // ⚠️ 今回スコープ外の既知衝突: staff.line_user_id は unique（1 LINE = 最大1 staff /
  //    getStaffContext の maybeSingle 前提・staff-invite.ts の line_taken ガードと同根）。
  //    既に別店の staff 行を持つ人が作ると、この INSERT は unique 違反で失敗する（＝兼任は未対応）。
  //    その場合は直前に作った salon を消してロールバックし、孤児サロンを残さない。
  const { error: ownerErr } = await supabaseAdmin.from("staff").insert({
    salon_id: salonId,
    name: ownerName,
    role: "manager",
    line_user_id: session.line_user_id,
  });
  if (ownerErr) {
    console.error("owner auto-register failed:", ownerErr);
    await supabaseAdmin.from("salons").delete().eq("id", salonId);
    return back("error=owner");
  }

  return back(`created=${salonId}`);
}
