import { NextResponse } from "next/server";
import { stripe, stripeOnboardingUrls } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireManager } from "@/lib/manager-guard";

/**
 * GET /api/manager/stripe/refresh — Account Links の refresh_url（Phase 2）。
 *
 * Account Link は数分で失効し、オンボーディング中のリロード・戻る/進むでもここに来る。
 *   その都度 accountLinks を再生成して再度リダイレクトする（＝再開できるようにする必須の受け口）。
 *
 * 認可: requireManager。account は ctx.salon_id にスコープした salon から引く（越境不能・§12）。
 */
export const runtime = "nodejs";

export async function GET() {
  const gate = await requireManager();
  if (!gate.ok) return gate.res;
  const { ctx } = gate;

  const baseUrl = process.env.APP_BASE_URL!;

  try {
    const { data: salon } = await supabaseAdmin
      .from("salons")
      .select("stripe_account_id")
      .eq("id", ctx.salon_id)
      .single();

    const accountId = salon?.stripe_account_id ?? null;
    if (!accountId) {
      // アカウント未作成なら再生成できない → ダッシュボード（未連携）へ。onboard から作り直す。
      return NextResponse.redirect(new URL("/dashboard", baseUrl));
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      ...stripeOnboardingUrls(baseUrl),
    });

    return NextResponse.redirect(link.url);
  } catch (e) {
    console.error("[stripe-refresh] failed:", e);
    return NextResponse.redirect(new URL("/dashboard?stripe=error", baseUrl));
  }
}
