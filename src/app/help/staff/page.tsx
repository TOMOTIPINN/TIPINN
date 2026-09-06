import type { Metadata } from "next";
import { Eyebrow, Card } from "@/components/ui";

/**
 * よくある質問・スタッフ向け（/help/staff・白世界）。**認証不要の公開ページ**。
 *
 * LINE公式アカウントのリッチメニュー「スタッフページ」側の導線に対応する FAQ。
 * スタッフ向けだが**認証はしない**（/staff に入れない・ログインできない状態で読む
 * ための情報なので、ここでログインを要求すると意味がなくなる）。
 * getSession() / isAdmin() / getStaffContext() は使わない（import もしない）。
 * データ取得なしの完全静的。誰が開いても同じ内容を出す。
 *
 * 表示環境: LINEアプリ内ブラウザ・モバイル幅（375px程度）前提。
 *   .container（max-width 440px）に収め、手順は縦積みの ol にする。インラインstyle無し（§8）。
 *
 * ⚠️ Android（Chrome）の手順は実機で未確認。コード上では検証できない内容のため、
 *    記述の正確性は原が別途実機で確認する。確認が済むまでこのコメントを残すこと。
 *    （LINE内ブラウザの「ブラウザで開く」表記は 2026-09-06 に iPhone 実機で確認済み。）
 */
export const metadata: Metadata = {
  title: "よくある質問（スタッフ向け） - echo",
  description:
    "echo のよくある質問（スタッフ向け）。来店受付のカメラ許可、スタッフページの開き方、ホーム画面への追加方法。",
};

const STAFF_URL = "https://echo-thanks.jp/staff";

export default function HelpStaffPage() {
  return (
    <main className="page page-top">
      <div className="container stack animate-in">
        <div className="stack stack-sm center-text">
          <Eyebrow>Help</Eyebrow>
          <h1 className="headline">よくある質問（スタッフ向け）</h1>
        </div>

        <Card className="stack stack-md">
          <h2 className="help-q">来店受付でカメラが起動しない</h2>
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
          <h2 className="help-q">スタッフページの開き方がわからない</h2>
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
          <h2 className="help-q">ホーム画面に追加する方法</h2>
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

          <p className="body">
            LINEのトーク画面から開いている場合は、画面右上のメニューから「ブラウザで開く」
            を選んでから、上の手順をお試しください。
          </p>
        </Card>

        {/* もう一方のFAQへ。JS無しの素の <a>＝スクリプトが動かない状況でも辿れる。 */}
        <p className="help-crosslink center-text">
          <a className="help-url" href="/help">
            お客様向けのよくある質問
          </a>
        </p>
      </div>
    </main>
  );
}
