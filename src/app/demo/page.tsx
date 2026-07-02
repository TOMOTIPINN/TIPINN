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
              {/* ★type="password" はパスワードマネージャー（iCloudキーチェーン/1Password等）が
                  autoComplete="off" を無視して割り込み、貼り付け値を切り詰める（64→33等）ため、
                  貼り付け前提のこの秘密入力では type="text" にする。あわせて各マネージャー/自動補完/
                  変換を明示的に無効化する。maxLength は付けない（切り詰め防止）。
                  ※デモ運用者が自端末で入力する用途のため画面表示は許容。 */}
              <input
                id="demo-key"
                className="field"
                type="text"
                name="key"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-1p-ignore="true"
                data-lpignore="true"
                data-form-type="other"
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
              className="btn btn-outline btn-block"
            >
              スタッフ個人として入る（スタッフ画面）
            </button>
            <button
              type="submit"
              name="as"
              value="manager"
              className="btn btn-outline btn-block"
            >
              店長として入る（店長 Inbox）
            </button>
          </form>
        </Card>
      </div>
    </main>
  );
}
