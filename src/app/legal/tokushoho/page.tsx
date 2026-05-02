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
        <p className={styles.lastUpdated}>最終更新日: 2026年5月2日</p>

        {/* Table */}
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <tbody>
              <tr>
                <th className={styles.th}>販売事業者名</th>
                <td className={styles.td}>合同会社carta</td>
              </tr>
              <tr>
                <th className={styles.th}>代表者名</th>
                <td className={styles.td}>原 朋之</td>
              </tr>
              <tr>
                <th className={styles.th}>所在地</th>
                <td className={styles.td}>
                  大阪市福島区福島6-16-9
                  <br />
                  エミネンス梅田西103
                </td>
              </tr>
              <tr>
                <th className={styles.th}>お問い合わせ先</th>
                <td className={styles.td}>
                  <a
                    href="mailto:hara@thankstipinn.biz"
                    className={styles.link}
                  >
                    hara@thankstipinn.biz
                  </a>
                </td>
              </tr>
              <tr>
                <th className={styles.th}>販売URL</th>
                <td className={styles.td}>
                  <a
                    href="https://tipinn-rho.vercel.app"
                    className={styles.link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    https://tipinn-rho.vercel.app
                  </a>
                </td>
              </tr>
              <tr>
                <th className={styles.th}>販売価格</th>
                <td className={styles.td}>
                  決済画面にて表示される金額（応援金額）とします。
                  <br />
                  （200円〜3,000円）
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
                <td className={styles.td}>PayPay決済</td>
              </tr>
              <tr>
                <th className={styles.th}>支払い時期</th>
                <td className={styles.td}>
                  決済完了時に即時課金されます。
                </td>
              </tr>
              <tr>
                <th className={styles.th}>サービスの提供時期</th>
                <td className={styles.td}>
                  決済完了後、即時システムに反映されます。
                </td>
              </tr>
              <tr>
                <th className={styles.th}>返品・キャンセル</th>
                <td className={styles.td}>
                  デジタルチップ・応援というサービスの性質上、決済完了後の返金・キャンセルはいかなる理由でもお受けできません。
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
