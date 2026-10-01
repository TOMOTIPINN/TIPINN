import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { isThrottled, recordAttempt } from "@/lib/login-attempts";
import { notifyRateLimitHit } from "@/lib/security-alert";
import { normalizeInviteCode } from "@/lib/owner-invite";

/**
 * POST /api/owner/join — オーナー招待を使ってオーナーになる（§21 コミット5e・migration 0050）。
 *   入力: code（招待コード・**POST の本文でだけ**受け取る）
 *   処理: レート制限 → ログイン → コードの正規化 → RPC `consume_owner_invite`（コードの確認 →
 *         すでにオーナーか → 招待の消費とオーナー登録を1トランザクションで）。
 *   応答: 成功 → /owner へ 303。失敗 → /owner/join?error=<分類語> へ 303。
 *
 * ★判定の順は §21「2026-09-24 決定」3 のとおり★
 *   レート制限 → ログイン → コードの確認（不正・使用済み・期限切れ）→ すでにオーナーか → 書き込み。
 *   アプリ側が受け持つのはレート制限とログインまで。以降は RPC の中（0050）。
 *   コードの確認が「すでにオーナーか」より先なので、すでにオーナーの人でも
 *   not_found / used / expired に到達できる（原のアカウントで失敗側を確認できる）。
 *
 * ★招待コードは秘密値★（持っていればオーナーになれる）
 *   ・URL・returnTo・state・ログに載せない。応答の URL に入るのは分類語だけ。
 *   ・**未ログインで送られてきたコードは捨てて**ログインへ送る（returnTo は /owner/join 固定）。
 *     ログイン後に本人がもう一度入力する。
 *   ・ログに出すのは分類語と error.code だけ。コード・line_user_id・RPC の引数は出さない。
 *
 * レート制限（scope owner_join・IP ごとに直近1時間で失敗10回・2026-10-01 決定）:
 *   失敗に数えるのは invalid_input / not_found / used / expired / already_owner。
 *   already_owner は「コードが有効で未使用」のときにしか出ない＝生きているコードの確認手段に
 *   なりうるので失敗に数える。ok は成功として記録する。ログインしていない POST は記録しない。
 *
 * 友だち追加は促さない（§21 決定8。login/route.ts の bot_prompt 対象に /owner/join は無い）。
 * 書き込みは RPC の中だけ（service_role・サーバー側）。
 */
export const runtime = "nodejs";

/** コード長（正規化後・ハイフンなし）。salon-invite.ts の CODE_LEN と同じ12。 */
const CODE_LEN = 12;

/** RPC が返す分類語（0050 の consume_owner_invite）。 */
const FAILURE_STATUSES = new Set([
  "invalid_input",
  "not_found",
  "used",
  "expired",
  "already_owner",
]);

export async function POST(req: Request) {
  const baseUrl = process.env.APP_BASE_URL!;
  const back = (qs: string) =>
    NextResponse.redirect(new URL(`/owner/join?${qs}`, baseUrl), {
      status: 303,
    });

  // 1) レート制限（ログインより前・決定3）。
  if (await isThrottled(req, "owner_join")) {
    await notifyRateLimitHit(req, "owner_join");
    return back("error=too_many");
  }

  // 2) ログイン。★送られてきたコードは読まずに捨てる★（returnTo にもどこにも載せない）。
  const session = await getSession();
  if (!session?.line_user_id) {
    return NextResponse.redirect(
      new URL(
        `/api/auth/line/login?returnTo=${encodeURIComponent("/owner/join")}`,
        baseUrl,
      ),
      { status: 303 },
    );
  }

  const form = await req.formData().catch(() => null);
  if (!form) return back("error=form");

  // 3) 正規化。空・桁違いは RPC を呼ばずに分類する（RPC の分類語と同じ語を使う）。
  const raw = form.get("code");
  const code = normalizeInviteCode(typeof raw === "string" ? raw : "");
  let status: string;
  if (code.length === 0) {
    status = "invalid_input";
  } else if (code.length !== CODE_LEN) {
    status = "not_found";
  } else {
    // 4) コードの確認以降は RPC（0050）。引数はログに出さない。
    const { data, error } = await supabaseAdmin.rpc("consume_owner_invite", {
      p_code: code,
      p_line_user_id: session.line_user_id,
    });
    if (error) {
      console.error("[owner/join] rpc failed", { code: error.code });
      return back("error=save");
    }
    const row = (Array.isArray(data) ? data[0] : null) as
      | { status?: string; joined_org_id?: string | null }
      | null;
    status = typeof row?.status === "string" ? row.status : "";

    if (status === "ok" && row?.joined_org_id) {
      await recordAttempt(req, "owner_join", true);
      return NextResponse.redirect(new URL("/owner", baseUrl), { status: 303 });
    }
  }

  if (FAILURE_STATUSES.has(status)) {
    await recordAttempt(req, "owner_join", false, status);
    return back(`error=${status}`);
  }

  // 想定外の戻り値（知らない status・ok なのに組織が無い等）。分類語だけ残す。
  console.error("[owner/join] unexpected rpc result", {
    status: status || "(empty)",
  });
  return back("error=save");
}
