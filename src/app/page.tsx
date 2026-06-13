import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * echo 最小ホーム（MVPスコープ①の土台）。
 * サーバーコンポーネントで getSession() を読み、ログイン状態を出し分ける。
 * ・未ログイン: LINEログインへの導線
 * ・ログイン済み: 表示名とログアウト
 * 個人情報の取得は service role でサーバー側のみ（原則8）。
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
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1.5rem",
        padding: "2rem",
        textAlign: "center",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: "2.5rem", fontWeight: 700, letterSpacing: "0.02em" }}>
        echo
      </h1>

      {session ? (
        <>
          <p style={{ fontSize: "1.1rem" }}>
            こんにちは、{displayName || "ゲスト"} さん
          </p>
          <form action="/api/auth/line/logout" method="post">
            <button
              type="submit"
              style={{
                padding: "0.6rem 1.4rem",
                borderRadius: "9999px",
                border: "1px solid #ccc",
                background: "#fff",
                fontSize: "0.95rem",
                cursor: "pointer",
              }}
            >
              ログアウト
            </button>
          </form>
        </>
      ) : (
        <>
          <p style={{ color: "#555", maxWidth: "20rem" }}>
            サロンへの「ありがとう」と評価を届けるアプリ
          </p>
          <a
            href="/api/auth/line/login"
            style={{
              padding: "0.75rem 1.6rem",
              borderRadius: "9999px",
              background: "#06C755",
              color: "#fff",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            LINEでログイン
          </a>
        </>
      )}
    </main>
  );
}
