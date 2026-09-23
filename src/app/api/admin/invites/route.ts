import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminApi } from "@/lib/admin-guard";
import { createInviteCode, inviteExpiryISO } from "@/lib/salon-invite";

/**
 * POST /api/admin/invites — サロン招待コードの新規発行（echo Labs 運営者のみ・migration 0043）。
 *   入力: org_id（**必須**・発行先の組織）／ recipient_email（任意・メモ用途。空でも発行できる）
 *   処理: 推測困難なコードを採番 → expires_at = now+14日 で1行 INSERT。
 *
 * ★発行先の組織を必須にする（§21 コミット4b・0048）★
 *   「サロンは必ず招待コードの発行者が指定した組織に所属する。組織の自動作成はしない」
 *   （§21 決定6）。org_id はクライアントから来る値なので、**organizations に実在するかを
 *   サーバー側で確認してから**入れる（FK 任せにしない＝エラーの出方を画面で制御する）。
 *   無い・不正なら error=org で戻す。
 *   ※ サロン作成側（checkInviteCode / salons.org_id / consumeInvite）は **コミット4c** で扱う。
 *      この時点では、org_id は招待に記録されるだけで作成の可否には影響しない。
 *
 * 認可: requireAdminApi（非運営者・未ログイン・env未設定は **404**。403 は返さない＝
 *   運営画面の存在を伏せる。@/lib/admin-guard 参照）。
 * メール送信はしない（要件）。「送った」は /admin/invites のチェックで手動記録する。
 *
 * 応答: フォーム送信 → /admin/invites?created=<code> へ 303。
 *   ★発行直後の1回だけ、コードをクエリで返して画面に大きく出す★
 *   一覧にも常時表示しているので秘匿の強度は上げていないが、ここは運営者しか到達できない。
 */
export const runtime = "nodejs";

const EMAIL_MAX = 254; // RFC 5321 の実務上の上限

export async function POST(req: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.res;

  const baseUrl = process.env.APP_BASE_URL!;
  const back = (qs: string) =>
    NextResponse.redirect(new URL(`/admin/invites?${qs}`, baseUrl), {
      status: 303,
    });

  const form = await req.formData().catch(() => null);
  if (!form) return back("error=form");

  // 宛先メールは**メモ**。厳密な検証はしない（社内メモに正規表現で門番を立てない）が、
  // 長さだけは切る。空なら null で持つ（「宛先未定で先に発行」を許す）。
  const raw = form.get("recipient_email");
  const email = typeof raw === "string" ? raw.trim() : "";
  if (email.length > EMAIL_MAX) return back("error=email");

  // 発行先の組織（必須・§21 コミット4b）。
  //   ★クライアントの値をそのまま INSERT しない★ organizations に実在する id か
  //   を先に確かめる。uuid として不正な文字列も、この select が空で返るので同じ error=org に畳む
  //   （形式の違いを応答に出さない）。
  const orgRaw = form.get("org_id");
  const orgId = typeof orgRaw === "string" ? orgRaw.trim() : "";
  if (!orgId) return back("error=org");

  const { data: org, error: orgError } = await supabaseAdmin
    .from("organizations")
    .select("id")
    .eq("id", orgId)
    .maybeSingle<{ id: string }>();

  if (orgError) {
    // uuid として不正な値は PostgREST が 22P02 を返す。存在しない場合と同じ扱いにする。
    console.error("[admin/invites] organizations の確認に失敗:", {
      code: orgError.code,
    });
    return back("error=org");
  }
  if (!org) return back("error=org");

  const code = createInviteCode();

  const { error } = await supabaseAdmin.from("salon_invites").insert({
    code,
    recipient_email: email || null,
    expires_at: inviteExpiryISO(),
    created_by_line_user_id: gate.lineUserId,
    // DB から引き直した値を入れる（フォームの文字列をそのまま使わない）。
    org_id: org.id,
  });

  if (error) {
    // code は unique。天文学的に低いが衝突したらここに来る（再送で解消する）。
    console.error("[admin/invites] insert failed:", error);
    return back("error=save");
  }

  return back(`created=${code}`);
}
