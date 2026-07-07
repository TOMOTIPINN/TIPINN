import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sanitizeReturnTo } from "@/lib/return-to";
import { Eyebrow, Button } from "@/components/ui";
import { EchoLogo } from "@/components/EchoLogo";

/**
 * echo ホーム（白世界・§5 デザインシステム準拠）。
 * サーバーコンポーネントで getSession() を読み、ログイン状態を出し分ける。
 * 個人情報の取得は service role でサーバー側のみ（原則7）。
 *
 * ?returnTo= を受け取り「LINEではじめる」に引き継ぐ（QR/招待導線の復帰用・§8）。
 *   callback が失敗時に付けて戻す returnTo をここで拾い、ホームに落ちても join へ戻れるようにする。
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;
  const safeReturn = sanitizeReturnTo(returnTo);
  const loginHref =
    safeReturn === "/"
      ? "/api/auth/line/login"
      : `/api/auth/line/login?returnTo=${encodeURIComponent(safeReturn)}`;

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
            <a href="/mypage" className="btn btn-outline btn-block">
              マイページへ
            </a>
            <form action="/api/auth/line/logout" method="post">
              <Button type="submit" variant="quiet" block>
                ログアウト
              </Button>
            </form>
          </div>
        ) : (
          <div className="stack stack-md">
            <p className="muted font-elegant">
              お客様とサロンをつなぐ、
              <br />
              言いそびれた、その「気持ち」を。
            </p>
            <a href={loginHref} className="btn btn-outline btn-block">
              LINEではじめる
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
