import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminApi } from "@/lib/admin-guard";
import { createInviteCode, inviteExpiryISO } from "@/lib/owner-invite";

/**
 * POST /api/admin/owner-invites — オーナー招待の新規発行（echo Labs 運営者のみ・§21 コミット5d・migration 0050）。
 *   入力: org_id（必須・この招待で登録されるオーナーの組織）／ recipient_email（任意・メモ用途）
 *   処理: コードを採番 → expires_at = now+14日（決定5）で owner_invites に1行 INSERT。
 *
 * 認可: requireAdminApi（非運営者・未ログイン・env未設定は **404**）。画面側の isAdmin とは別に必ず確かめる。
 *
 * ★org_id はクライアントの値をそのまま入れない★ organizations に実在するかを確かめ、
 *   DB から引き直した id を入れる（/api/admin/invites と同じ）。uuid として不正な値も error=org に畳む。
 *
 * ★本数は制限しない★（2026-10-01 決定・§21 5d (c)）。同じ組織に2本目を出しても、
 *   すでにオーナーがいる組織に出してもよい。代わりに画面に「オーナーm名・未使用の招待n本」を出す。
 *
 * ★コードを URL・ログに出さない★
 *   応答は /admin/owner-invites?created=1 へ 303（/admin/invites の ?created=<code> の形は真似しない）。
 *   コードは一覧の行で見せる。ログには error.code だけを出す（PostgREST の details には
 *   unique 違反のキー値＝コードが入りうるため、error オブジェクト全体は出さない）。
 */
export const runtime = "nodejs";

const EMAIL_MAX = 254; // RFC 5321 の実務上の上限

export async function POST(req: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.res;

  const baseUrl = process.env.APP_BASE_URL!;
  const back = (qs: string) =>
    NextResponse.redirect(new URL(`/admin/owner-invites?${qs}`, baseUrl), {
      status: 303,
    });

  const form = await req.formData().catch(() => null);
  if (!form) return back("error=form");

  // 宛先メールは**メモ**。長さだけ切る。空なら null。
  const raw = form.get("recipient_email");
  const email = typeof raw === "string" ? raw.trim() : "";
  if (email.length > EMAIL_MAX) return back("error=email");

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
    console.error("[admin/owner-invites] organizations の確認に失敗:", {
      code: orgError.code,
    });
    return back("error=org");
  }
  if (!org) return back("error=org");

  const { error } = await supabaseAdmin.from("owner_invites").insert({
    code: createInviteCode(),
    org_id: org.id,
    recipient_email: email || null,
    expires_at: inviteExpiryISO(),
    created_by_line_user_id: gate.lineUserId,
  });

  if (error) {
    // code は unique。衝突したらここに来る（再送で別のコードになる）。
    console.error("[admin/owner-invites] insert failed:", { code: error.code });
    return back("error=save");
  }

  return back("created=1");
}
