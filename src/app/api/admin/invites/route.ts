import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminApi } from "@/lib/admin-guard";
import { createInviteCode, inviteExpiryISO } from "@/lib/salon-invite";

/**
 * POST /api/admin/invites — サロン招待コードの新規発行（echo Labs 運営者のみ・migration 0043）。
 *   入力: recipient_email（任意・メモ用途。空でも発行できる）
 *   処理: 推測困難なコードを採番 → expires_at = now+14日 で1行 INSERT。
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

  const code = createInviteCode();

  const { error } = await supabaseAdmin.from("salon_invites").insert({
    code,
    recipient_email: email || null,
    expires_at: inviteExpiryISO(),
    created_by_line_user_id: gate.lineUserId,
  });

  if (error) {
    // code は unique。天文学的に低いが衝突したらここに来る（再送で解消する）。
    console.error("[admin/invites] insert failed:", error);
    return back("error=save");
  }

  return back(`created=${code}`);
}
