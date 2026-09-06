import type { Metadata } from "next";
import { Eyebrow, Card } from "@/components/ui";

/**
 * よくある質問（/help・白世界）。**認証不要の公開ページ**。
 *
 * LINE公式アカウントのリッチメニューから開く導線を想定。
 * 「echo が開けない・使えない」状態で必要になる情報なので、ログインできなくても読めること
 * が要件＝getSession() / isAdmin() / getStaffContext() は使わない（import もしない）。
 * データ取得なしの完全静的。誰が開いても同じ内容を出す。
 *
 * 表示環境: LINEアプリ内ブラウザ・モバイル幅（375px程度）前提。
 *   .container（max-width 440px）に収め、手順は縦積みの ol にする。インラインstyle無し（§8）。
 *
 * ⚠️ Android（Chrome）の手順は実機で未確認。コード上では検証できない内容のため、
 *    記述の正確性は原が別途実機で確認する。確認が済むまでこのコメントを残すこと。
 */
export const metadata: Metadata = {
  title: "よくある質問 - echo",
  description:
    "echo のよくある質問。LINEのご案内、QRコードの読み取り、来店受付のカメラ許可、スタッフページの開き方など。",
};

const STAFF_URL = "https://echo-thanks.jp/staff";

export default function HelpPage() {
  return (
    <main className="page page-top">
      <div className="container stack animate-in">
        <div className="stack stack-sm center-text">
          <Eyebrow>Help</Eyebrow>
          <h1 className="headline">よくある質問</h1>
        </div>

        {/* ── お客様へ ───────────────────────────── */}
        <h2 className="headline-sm">お客様へ</h2>

        <Card className="stack stack-md">
          <h3 className="help-q">LINEでご案内が届かない</h3>
          <p className="body">
            ご案内は、LINE公式アカウントを友だち追加していただいた方にお送りしています。
            友だち追加がまだの場合は、マイページの「公式アカウントを友だち追加」からお願いします。
          </p>
          <p className="body">
            友だち追加がお済みの場合、ご来店から10〜20分後にお送りしています。少しお待ちください。
          </p>
        </Card>

        <Card className="stack stack-md">
          <h3 className="help-q">QRコードが読み取れない</h3>
          <p className="body">
            スマートフォンのカメラアプリで、コード全体が画面に入るように写してください。
            うまくいかない場合は、少し離れる、明るい場所で試す、画面の明るさを上げる、などをお試しください。
          </p>
        </Card>

        <hr className="rule" />

        {/* ── スタッフの方へ ─────────────────────── */}
        <h2 className="headline-sm">スタッフの方へ</h2>

        <Card className="stack stack-md">
          <h3 className="help-q">来店受付でカメラが起動しない</h3>
          <p className="body">ブラウザのカメラ許可が必要です。</p>

          <div className="stack stack-sm">
            <p className="help-os">iPhone（Safari）の場合</p>
            <ol className="help-steps">
              <li>設定アプリを開く</li>
              <li>「アプリ」→「Safari」を開く</li>
              <li>「カメラ」を「許可」または「確認」に変更する</li>
              <li>echo を開き直して、もう一度お試しください</li>
            </ol>
          </div>

          {/* ⚠️ 実機未確認（原が別途確認）。 */}
          <div className="stack stack-sm">
            <p className="help-os">Android（Chrome）の場合</p>
            <ol className="help-steps">
              <li>Chrome で echo を開く</li>
              <li>アドレスバー左の鍵アイコンをタップ</li>
              <li>「権限」→「カメラ」を「許可」に変更する</li>
              <li>ページを再読み込みしてください</li>
            </ol>
          </div>
        </Card>

        <Card className="stack stack-md">
          <h3 className="help-q">スタッフページの開き方がわからない</h3>
          <p className="body">スタッフページは以下のURLです。</p>
          <p className="body">
            <a className="help-url" href={STAFF_URL}>
              {STAFF_URL}
            </a>
          </p>
          <p className="body">
            LINEでログインしていれば、そのままご自分のページが開きます。
          </p>
        </Card>

        <Card className="stack stack-md">
          <h3 className="help-q">ホーム画面に追加する方法</h3>
          <p className="body">
            毎回URLを入力しなくて済むよう、ホーム画面への追加をおすすめします。
          </p>

          <div className="stack stack-sm">
            <p className="help-os">iPhone（Safari）の場合</p>
            <ol className="help-steps">
              <li>{STAFF_URL} を Safari で開く</li>
              <li>画面下の共有ボタン（□に↑）をタップ</li>
              <li>「ホーム画面に追加」を選ぶ</li>
            </ol>
          </div>

          {/* ⚠️ 実機未確認（原が別途確認）。 */}
          <div className="stack stack-sm">
            <p className="help-os">Android（Chrome）の場合</p>
            <ol className="help-steps">
              <li>{STAFF_URL} を Chrome で開く</li>
              <li>右上のメニュー（⋮）をタップ</li>
              <li>「ホーム画面に追加」を選ぶ</li>
            </ol>
          </div>
        </Card>
      </div>
    </main>
  );
}
