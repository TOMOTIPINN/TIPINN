import type { Metadata } from "next";
import Link from "next/link";
import styles from "./tokushoho.module.css";

export const metadata: Metadata = {
  title: "特定商取引法に基づく表記 | tipinn",
  description: "tipinnの特定商取引法に基づく表記です。",
};

export default function TokushohoPage() {
  return (
    <div className="page-wrapper">
      <div className={styles.container}>
        {/* Header */}
        <header className={styles.header}>
          <Link href="/" className={styles.backLink} id="back-to-home">
            <span className={styles.backArrow}>←</span>
            <span>トップに戻る</span>
          </Link>
        </header>

        {/* Title */}
        <h1 className={styles.pageTitle}>特定商取引法に基づく表記</h1>
        <p className={styles.lastUpdated}>最終更新日: 2026年5月1日</p>

        {/* Table */}
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <tbody>
              <tr>
                <th className={styles.th}>販売事業者名</th>
                <td className={styles.td}>tipinn運営事務局</td>
              </tr>
              <tr>
                <th className={styles.th}>運営統括責任者</th>
                <td className={styles.td}>
                  請求があった際に遅滞なく開示いたします
                </td>
              </tr>
              <tr>
                <th className={styles.th}>所在地</th>
                <td className={styles.td}>
                  請求があった際に遅滞なく開示いたします
                </td>
              </tr>
              <tr>
                <th className={styles.th}>電話番号</th>
                <td className={styles.td}>
                  請求があった際に遅滞なく開示いたします
                </td>
              </tr>
              <tr>
                <th className={styles.th}>メールアドレス</th>
                <td className={styles.td}>info@tipinn.jp</td>
              </tr>
              <tr>
                <th className={styles.th}>販売URL</th>
                <td className={styles.td}>
                  <a
                    href="https://tipinn.vercel.app"
                    className={styles.link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    https://tipinn.vercel.app
                  </a>
                </td>
              </tr>
              <tr>
                <th className={styles.th}>販売価格</th>
                <td className={styles.td}>
                  各チップ金額は、選択画面に表示された金額に準じます。
                  <br />
                  （200円 / 500円 / 1,500円 / 3,000円）
                </td>
              </tr>
              <tr>
                <th className={styles.th}>
                  商品代金以外の
                  <br />
                  必要料金
                </th>
                <td className={styles.td}>
                  なし（決済手数料はサービス提供者が負担します）
                </td>
              </tr>
              <tr>
                <th className={styles.th}>支払い方法</th>
                <td className={styles.td}>PayPay（オンライン決済）</td>
              </tr>
              <tr>
                <th className={styles.th}>支払い時期</th>
                <td className={styles.td}>
                  チップ送信時に即時決済されます。
                </td>
              </tr>
              <tr>
                <th className={styles.th}>商品の引き渡し時期</th>
                <td className={styles.td}>
                  決済完了と同時に、チップが対象スタイリストへ送信されます。
                </td>
              </tr>
              <tr>
                <th className={styles.th}>返品・キャンセル</th>
                <td className={styles.td}>
                  チップの性質上、決済完了後の返品・キャンセル・返金はお受けできません。
                  <br />
                  ただし、システム障害等による二重決済等が発生した場合は、お問い合わせいただければ対応いたします。
                </td>
              </tr>
              <tr>
                <th className={styles.th}>動作環境</th>
                <td className={styles.td}>
                  最新版のGoogle Chrome、Safari、Microsoft
                  Edgeを推奨しています。PayPayアプリがインストールされたスマートフォンが必要です。
                </td>
              </tr>
              <tr>
                <th className={styles.th}>特別条件</th>
                <td className={styles.td}>
                  本サービスにおけるチップは、お客様からスタイリスト個人への感謝の贈り物であり、美容室のサービス料金とは異なります。
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <footer className={styles.footer}>
          <Link href="/" className={styles.footerLink}>
            tipinn トップページへ
          </Link>
        </footer>
      </div>
    </div>
  );
}
