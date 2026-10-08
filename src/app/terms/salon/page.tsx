import type { Metadata } from "next";
import { Eyebrow, Card } from "@/components/ui";
import { SALON_TERMS_VERSION, getSalonTermsBody } from "@/lib/salon-terms";
import SalonTermsDocument from "./SalonTermsDocument";

/**
 * サロン向け利用規約・現在の版（/terms/salon・白世界）。**認証不要の公開ページ**（§26 決定4・C2）。
 *
 * 契約の前に読めることが要件なので、ログインを求めない。
 * getSession() / isAdmin() / getStaffContext() は使わない（import もしない）。
 * **DB は読まない**。版と本文は `@/lib/salon-terms` の台帳だけから決まる＝誰が開いても同じ内容。
 *
 * ★版が null の間は「準備中」★（閉じる側に倒す・§26 決定4）
 *   本文が確定するまで（2026-10-14 予定）、叩き台の文面を仮に置くこともしない。
 *
 * 導線: **どの画面からもリンクしない**（C3 で /owner/join の同意欄から張る）。
 * 版ごとの固定 URL は /terms/salon/[version]。同意の記録が指すのはそちら。
 *
 * ★版が null の間だけ noindex★（40_decisions.md §26「2026-10-08 決定（noindex）」）
 *   「準備中」を検索結果に残さないため。判定は版の定数だけなので、C5 で版を入れると自動で外れる。
 *   版ごとのページ（/terms/salon/[version]）には付けない（古い版の扱いは2つ目の版ができるときに決める）。
 *
 * 表示環境: LINEアプリ内ブラウザ・モバイル幅（375px程度）前提。
 *   .container（max-width 440px）に収める。インラインstyle無し（30_design.md §7）。
 */
export const metadata: Metadata = {
  title: "サロン向け利用規約 - echo",
  description: "echo のサロン向け利用規約。",
  ...(SALON_TERMS_VERSION === null ? { robots: { index: false } } : {}),
};

export default function SalonTermsPage() {
  const Body =
    SALON_TERMS_VERSION === null ? null : getSalonTermsBody(SALON_TERMS_VERSION);

  // 版が null、または（起こらない想定だが）台帳から本文を引けない場合は準備中に倒す。
  if (SALON_TERMS_VERSION === null || Body === null) {
    return (
      <main className="page page-top">
        <div className="container stack animate-in">
          <div className="stack stack-sm center-text">
            <Eyebrow>Terms</Eyebrow>
            <h1 className="headline">サロン向け利用規約</h1>
          </div>

          <Card className="stack stack-md">
            <p className="body">
              サロン向け利用規約は、ただいま準備中です。公開まで今しばらくお待ちください。
            </p>
            <p className="muted">
              ご不明な点は、echo 運営（info@echo-thanks.jp）までお問い合わせください。
            </p>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <SalonTermsDocument version={SALON_TERMS_VERSION} Body={Body} isCurrent />
  );
}
