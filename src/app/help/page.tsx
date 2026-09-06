import type { Metadata } from "next";
import { Eyebrow, Card } from "@/components/ui";

/**
 * よくある質問・お客様向け（/help・白世界）。**認証不要の公開ページ**。
 *
 * LINE公式アカウントのリッチメニューから開く導線を想定。リッチメニューが
 * 「お客様ページ(/mypage)」「スタッフページ(/staff)」の2枠構成なのに合わせ、
 * FAQ も顧客向け(/help)とスタッフ向け(/help/staff)に分けている。
 * 「echo が開けない・使えない」状態で必要になる情報なので、ログインできなくても読めること
 * が要件＝getSession() / isAdmin() / getStaffContext() は使わない（import もしない）。
 * データ取得なしの完全静的。誰が開いても同じ内容を出す。
 *
 * 表示環境: LINEアプリ内ブラウザ・モバイル幅（375px程度）前提。
 *   .container（max-width 440px）に収める。インラインstyle無し（§8）。
 */
export const metadata: Metadata = {
  title: "よくある質問 - echo",
  description:
    "echo のよくある質問（お客様向け）。LINEのご案内、QRコードの読み取りについて。",
};

export default function HelpPage() {
  return (
    <main className="page page-top">
      <div className="container stack animate-in">
        <div className="stack stack-sm center-text">
          <Eyebrow>Help</Eyebrow>
          <h1 className="headline">よくある質問</h1>
        </div>

        <Card className="stack stack-md">
          <h2 className="help-q">LINEでご案内が届かない</h2>
          <p className="body">
            ご案内は、LINE公式アカウントを友だち追加していただいた方にお送りしています。
            友だち追加がまだの場合は、マイページの「公式アカウントを友だち追加」からお願いします。
          </p>
          <p className="body">
            友だち追加がお済みの場合、ご来店から10〜20分後にお送りしています。少しお待ちください。
          </p>
        </Card>

        <Card className="stack stack-md">
          <h2 className="help-q">QRコードが読み取れない</h2>
          <p className="body">
            スマートフォンのカメラアプリで、コード全体が画面に入るように写してください。
            うまくいかない場合は、少し離れる、明るい場所で試す、画面の明るさを上げる、などをお試しください。
          </p>
        </Card>

        {/* もう一方のFAQへ。JS無しの素の <a>＝スクリプトが動かない状況でも辿れる。 */}
        <p className="help-crosslink center-text">
          <a className="help-url" href="/help/staff">
            スタッフの方はこちら
          </a>
        </p>
      </div>
    </main>
  );
}
