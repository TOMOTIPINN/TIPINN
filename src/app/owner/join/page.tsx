import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Eyebrow, Card } from "@/components/ui";

/**
 * オーナー招待を使う画面（/owner/join・§21 コミット5e・migration 0050）。
 *
 * 導線: 運営者が招待コードと一緒に https://echo-thanks.jp/owner/join を伝える（2026-10-01 決定）。
 *   アプリ内の他の画面からはリンクを張らない。
 *
 * ★招待コードは URL で受け取らない★
 *   未ログインならログインへ送り（returnTo は /owner/join 固定）、戻ってきてから本人が入力する。
 *   コードは POST の本文でだけ /api/owner/join に送る。?error= に入るのは分類語だけ。
 *
 * 認可: ログインのみ。**requireOwnerPage は置かない**（オーナーになる前の人が使う画面）。
 *   **すでにオーナーの人にもフォームを出す**（判定順はコードの確認が先＝原のアカウントで
 *   not_found / used / expired を確認できる・§21「2026-09-24 決定」3）。
 *
 * 文言: not_found・used・expired は区別して出す（サロン招待に揃える・2026-10-01 決定）。
 *   エラー文言は Object.hasOwn で表に実在するキーだけを引く。
 *
 * トーン: サロンUI（data-role="owner"）。インライン style 禁止・赤なし。
 */
export const dynamic = "force-dynamic";

const ERROR_MESSAGE: Record<string, string> = {
  form: "送信データを読み取れませんでした。もう一度お試しください。",
  invalid_input: "招待コードを入力してください。",
  not_found: "招待コードが正しくありません。",
  used: "この招待コードはすでに使用されています。",
  expired:
    "この招待コードは有効期限が切れています。お手数ですが、echo 運営（info@echo-thanks.jp）までご連絡ください。",
  too_many: "試行が多すぎます。時間をおいて再度お試しください。",
  save: "処理できませんでした。時間をおいて再度お試しください。",
};

export default async function OwnerJoinPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const session = await getSession();
  if (!session) {
    redirect(
      `/api/auth/line/login?returnTo=${encodeURIComponent("/owner/join")}`,
    );
  }

  const alreadyOwner = error === "already_owner";
  const message =
    error && Object.hasOwn(ERROR_MESSAGE, error) ? ERROR_MESSAGE[error] : null;

  return (
    <main className="page page-top" data-role="owner">
      <div className="container stack animate-in">
        <header className="stack-sm">
          <Eyebrow>Owner</Eyebrow>
          <h1 className="headline">オーナー登録</h1>
          <p className="muted">
            echo 運営からお送りした招待コードを入力してください。登録すると、組織の店舗の数字と感想を見られるようになります。
          </p>
        </header>

        {alreadyOwner && (
          <div className="notice notice-error">
            このアカウントはすでにオーナーとして登録されています。{" "}
            <Link href="/owner">オーナーの画面を開く</Link>
          </div>
        )}
        {!alreadyOwner && error && (
          <div className="notice notice-error">
            {message ?? "エラーが発生しました。"}
          </div>
        )}

        <Card>
          <form action="/api/owner/join" method="post" className="stack-md">
            <div className="field-group">
              <label className="field-label" htmlFor="code">
                招待コード（必須）
              </label>
              <input
                id="code"
                name="code"
                className="field"
                type="text"
                required
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="XXXX-XXXX-XXXX"
              />
              <span className="field-help">
                大文字・小文字とハイフンは問いません。
              </span>
            </div>
            <button type="submit" className="btn btn-outline btn-block">
              オーナーとして登録
            </button>
          </form>
        </Card>
      </div>
    </main>
  );
}
