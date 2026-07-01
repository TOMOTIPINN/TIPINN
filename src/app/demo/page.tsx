import { notFound } from "next/navigation";
import { Eyebrow, Card } from "@/components/ui";
import { isDemoLoginEnabled } from "@/lib/demo";

/**
 * 営業デモ用ログインフォーム（本番Prodでは無効・Previewのみ）。
 *
 * env 二重ゲートが無効なら 404（存在自体を隠す＝API と同じ扱い）。
 * シークレットは password 入力で受け取り、POST body で送る（クエリに出さない＝
 * アクセスログ/履歴/Referer に残さない）。どちらのボタンで送信したかで as が決まる。
 */
export default async function DemoLoginPage() {
  if (!isDemoLoginEnabled()) notFound();

  return (
    <main className="page page-top">
      <div className="container stack animate-in">
        <header className="stack-sm center-text">
          <Eyebrow>Demo access</Eyebrow>
          <h1 className="headline">デモにログイン</h1>
          <p className="muted">
            営業デモ専用の入口です。シークレットを入力し、見たい視点を選んでください。
          </p>
        </header>

        <Card>
          <form
            method="POST"
            action="/api/demo/login"
            className="stack stack-md"
          >
            <div className="field-group">
              <label className="field-label" htmlFor="demo-key">
                デモシークレット
              </label>
              <input
                id="demo-key"
                className="field"
                type="password"
                name="key"
                autoComplete="off"
                required
              />
            </div>

            {/* name/value を持つ submit で as を渡す（押したボタンの value だけ送信される）。 */}
            <button
              type="submit"
              name="as"
              value="customer"
              className="btn btn-outline btn-block"
            >
              顧客として入る（マイページ）
            </button>
            <button
              type="submit"
              name="as"
              value="staff"
              className="btn btn-quiet btn-block"
            >
              スタッフとして入る（スタッフ画面）
            </button>
          </form>
        </Card>
      </div>
    </main>
  );
}
