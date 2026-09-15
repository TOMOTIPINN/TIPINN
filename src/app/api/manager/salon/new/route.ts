import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";
import {
  SALON_ASSETS_BUCKET,
  validateImage,
  uploadPublicImage,
  removePublicImage,
} from "@/lib/storage";
import { checkInviteCode, consumeInvite } from "@/lib/salon-invite";

/**
 * POST /api/manager/salon/new — サロン・オンボーディング（Phase 1 / Stripe未接続 / [[auth-method-line-b]]）。
 *   入力: code（招待コード・必須）／name（店名・必須）／logo（任意・form-data の File）／
 *         notify_after_minutes（任意・既定180）。
 *
 * ★招待制（migration 0043）★
 *   以前はLINEログインさえ通れば誰でもサロンを作れた。有効な招待コード（未使用・期限内）を
 *   必須にして塞いだ。コードの発行は /admin/invites（echo Labs 運営者のみ）。
 *   消費は salons INSERT の**後**に consumeInvite の条件付き UPDATE で原子的に行う
 *   （事前チェックだけだと同じコードで2サロン作れる）。順序は下の実装コメントを参照。
 *   処理: salon_id と visit_token をサーバー側で採番（crypto.randomUUID）→ ロゴがあれば
 *         salon-assets/salons/<salon_id>/logo に upsert → salons へ単一 INSERT。
 *         stripe_account_id は空のまま（Phase 2 で埋める）。
 *   自動登録: salons INSERT 成功後、作成者を新サロンの店長(role=manager)として staff に1行 INSERT。
 *
 * ★公開同意（migration 0045）★
 *   自動登録された staff 行は、その時点から顧客に氏名が表示される（/api/staff の絞り込みは
 *   role を見ない）。この経路は**本人が自分で操作している**ので、同意は本人から直接取る
 *   （店長の申告では許諾にならない・弁護士見解 / docs/40_decisions.md §10）。
 *   ・publish_consent が明示的な肯定値でなければ **back("error=consent")**。
 *     検証は **salons / staff / Storage のどの書き込みより前**（フォーム読み取りの直後）に置く。
 *   ・staff の id は salon_id / visit_token と同じくサーバー側で randomUUID して
 *     **1回の INSERT** に id と publish_consent_confirmed_by を同じ値で載せる（2段階 UPDATE にしない）。
 *   ・id・日時はクライアントから受け取らない。
 *   ・この2列は**記録であって公開の制御ではない**（顧客側の表示条件は archived_at のみ）。
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

  // 公開同意（0045）。**明示的な肯定値以外はすべて拒否**（欠落・"false"・"0"・空文字を含む）。
  // ★位置★ 招待コードの照会より前、Storage アップロード・salons/staff の INSERT より前。
  //   ここを後ろに置くと、同意なしのリクエストでもロゴが Storage に残ったり、
  //   最悪サロンを作ってからロールバックすることになる。
  if (!isConsentGiven(form.get("publish_consent"))) {
    return back("error=consent");
  }

  // 招待コード（必須・migration 0043）。ロゴのアップロードより前に弾く
  // （無効なコードで Storage に孤児ファイルを作らせない）。
  // ここは表示用の事前チェックにすぎず、可否の最終判定は下の consumeInvite が行う。
  const codeRaw = form.get("code");
  const code = typeof codeRaw === "string" ? codeRaw : "";
  const invite = await checkInviteCode(code);
  if (!invite.ok) return back(`error=invite_${invite.reason}`);

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
  // オーナーの staff 行の id も先に採番する（salonId / visitToken と同じ作法）。
  // こうすると publish_consent_confirmed_by に「その行自身の id」を
  // **同じ INSERT の中で**入れられる＝INSERT→UPDATE の2段階にしなくて済む。
  const ownerStaffId = randomUUID();

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
    // ロゴは salons INSERT **より前**にアップロード済み。行は無いがファイルだけ残るため、
    // 消す行が無いのが正常な経路として expectRow:false でロールバックを通す。
    await rollbackSalon(salonId, logoUrl, { expectRow: false });
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
    id: ownerStaffId,
    salon_id: salonId,
    name: ownerName,
    role: "manager",
    line_user_id: session.line_user_id,
    // 0045。このフォームで本人が同意した記録。confirmed_by は自分自身の id
    // （= ownerStaffId）で、クライアントからは受け取らない。
    publish_consent_confirmed_at: new Date().toISOString(),
    publish_consent_confirmed_by: ownerStaffId,
  });
  if (ownerErr) {
    console.error("owner auto-register failed:", ownerErr);
    await rollbackSalon(salonId, logoUrl);
    return back("error=owner");
  }

  // 招待の消費（原子的・migration 0043）。salon_id が FK で salons を参照するため、
  // salons INSERT より前には実行できない＝必ずここ（最後）になる。
  // 更新できた行が1件でなければ、他のリクエストに先を越された／この間に期限切れになった。
  const consumed = await consumeInvite(code, salonId);
  if (!consumed) {
    console.error("[salon/new] invite consume lost the race; rolling back", {
      salonId,
    });
    await supabaseAdmin.from("staff").delete().eq("salon_id", salonId);
    await rollbackSalon(salonId, logoUrl);
    return back("error=invite_race");
  }

  return back(`created=${salonId}`);
}

/**
 * 公開同意の申告を厳格に判定する（0045・/api/staff/bind の isConsentGiven と同じ方針）。
 *
 * **true と判定するのは明示的な肯定値のみ**。欠落（null）・"false"・"0"・空文字はすべて
 * false ＝ error=consent になる。緩めて「値があれば true」にすると、欠落だけを弾いて
 * 否定値を通してしまう。checkbox は checked のとき "on" を送るため、これを肯定値として受ける。
 */
function isConsentGiven(value: FormDataEntryValue | null): boolean {
  if (typeof value !== "string") return false;
  return value === "on" || value === "true" || value === "1";
}

/**
 * 作りかけの salon とアップロード済みロゴを消す（補償トランザクション）。
 *
 * 以前は delete の戻り値を捨てていたため、**ロールバック自体が失敗しても誰も気づけず**
 * 店長不在の孤児サロンが残り得た。削除結果を確認し、失敗したら salon_id 付きで
 * console.error に残す（孤児を後から特定できるようにする）。
 * 呼び出し側の応答は変えない（ユーザーには元のエラーを返す）。
 *
 * ロゴは salons INSERT **より前**にアップロードされる。よって INSERT 自体が失敗した経路
 * （＝消すべき行が無い経路）でもこの関数を通さないとファイルだけが孤児として残る。
 *
 * @param logoUrl   アップロード済みロゴの public URL。null＝ロゴ未選択で、Storage には触れない。
 * @param opts.expectRow
 *   true（既定）＝ salons に行がある前提。消せなければ★ログ（従来の挙動）。
 *   false ＝ INSERT が失敗した経路。**行が無いのが正常**なので、行削除の結果に関わらず
 *   ログを出さない（正常系を★ログで汚さない）。ロゴの remove は変わらず実行する。
 *
 * Storage の失敗は removePublicImage 側のログのみ。ここで応答を変えると、
 * ユーザーに元の失敗理由が伝わらなくなる。
 */
async function rollbackSalon(
  salonId: string,
  logoUrl: string | null,
  opts?: { expectRow?: boolean },
): Promise<void> {
  const expectRow = opts?.expectRow ?? true;

  const { data, error } = await supabaseAdmin
    .from("salons")
    .delete()
    .eq("id", salonId)
    .select("id");

  if (expectRow && (error || !data || data.length === 0)) {
    console.error(
      `[salon/new] ★ロールバック失敗＝孤児サロンが残った可能性 salon_id=${salonId}`,
      error,
    );
  }

  // ロゴ未選択なら消すものが無い。
  if (!logoUrl) return;

  await removePublicImage({
    bucket: SALON_ASSETS_BUCKET,
    path: `salons/${salonId}/logo`,
  });
}
