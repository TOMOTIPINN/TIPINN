import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Eyebrow, Button } from "@/components/ui";
import { EchoLogo } from "@/components/EchoLogo";

/**
 * echo ホーム（白世界・§5 デザインシステム準拠）。
 * サーバーコンポーネントで getSession() を読み、ログイン状態を出し分ける。
 * 個人情報の取得は service role でサーバー側のみ（原則7）。
 */
export default async function HomePage() {
  const session = await getSession();

  let displayName = "";
  if (session) {
    const { data } = await supabaseAdmin
      .from("customers")
      .select("display_name")
      .eq("id", session.customer_id)
      .single();
    displayName = data?.display_name ?? "";
  }

  return (
    <main className="page">
      <div className="container stack center-text animate-in">
        <h1 className="center-text">
          <EchoLogo size={64} />
        </h1>
        <Eyebrow>Your work echoes.</Eyebrow>

        {session ? (
          <div className="stack stack-md">
            <p className="body">
              こんにちは、{displayName || "ゲスト"} さん
            </p>
            <form action="/api/auth/line/logout" method="post">
              <Button type="submit" variant="quiet" block>
                ログアウト
              </Button>
            </form>
          </div>
        ) : (
          <div className="stack stack-md">
            <p className="muted">サロンへの「ありがとう」と評価を届けるアプリ</p>
            <a href="/api/auth/line/login" className="btn btn-outline btn-block">
              LINEではじめる
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
