import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sanitizeReturnTo } from "@/lib/return-to";
import { Eyebrow, Card } from "@/components/ui";

/**
 * 表示名の確定（初回チェックイン直前・白世界・§5）。ルート: /onboarding/name
 *
 * 名前1項目のみ・必須・1回だけ（後から /mypage で変更可）。店頭でスタッフが対面案内する前提。
 * 顧客デバイス上の唯一の事前画面＝/mypage（チェックインQR）に入る手前でここを挟む。
 *
 * 認証（方式B / [[auth-method-line-b]]）: 未ログイン→returnTo付きでLINEログインへ。
 *   既に確定済み（name_confirmed_at あり）なら二度と挟まず returnTo（既定 /mypage）へ素通し。
 * 個人情報は service role でサーバー側のみ（原則7）。インラインstyle無し（§8）。
 */
export default async function OnboardingNamePage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string }>;
}) {
  const { returnTo, error } = await searchParams;
  const safeReturn = returnTo ? sanitizeReturnTo(returnTo) : "/mypage";

  const session = await getSession();
  if (!session) {
    const back = `/onboarding/name?returnTo=${encodeURIComponent(safeReturn)}`;
    redirect(`/api/auth/line/login?returnTo=${encodeURIComponent(back)}`);
  }

  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("display_name, name_confirmed_at")
    .eq("id", session.customer_id)
    .single();

  // 確定済みなら二度と挟まない（returnTo へ素通し）。
  if (customer?.name_confirmed_at) {
    redirect(safeReturn);
  }

  // LINE名を初期値に置き、その場で確認・修正できるようにする。
  const defaultName = customer?.display_name ?? "";

  return (
    <main className="page">
      <div className="container stack center-text animate-in">
        <Eyebrow>Welcome to echo</Eyebrow>
        <h1 className="headline">お名前を教えてください</h1>
        <Card>
          <form action="/api/customer/name" method="post" className="stack-md">
            <input type="hidden" name="returnTo" value={safeReturn} />
            <div className="field-group">
              <label className="field-label" htmlFor="name">
                お名前
              </label>
              <input
                id="name"
                name="name"
                className="field"
                type="text"
                maxLength={50}
                required
                defaultValue={defaultName}
                placeholder="例：山田 はな"
                autoComplete="name"
              />
            </div>
            {error && (
              <p className="muted">お名前を入力してください。</p>
            )}
            <button type="submit" className="btn btn-outline btn-block">
              はじめる
            </button>
          </form>
          <p className="note-fine">
            スタンプや感想に表示されます。あとから変更できます。
          </p>
        </Card>
      </div>
    </main>
  );
}
