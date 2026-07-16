import type { Metadata, Viewport } from "next";
import {
  Cormorant_Garamond,
  Shippori_Mincho,
  Noto_Sans_JP,
  Outfit,
} from "next/font/google";
import "./globals.css";

/* フォント方針（CLAUDE.md §5 を読みやすさ優先で更新）。
   基本＝ゴシック（Noto Sans JP）。本文・ボタン・ラベル・フォーム・数値データ等の
   機能的テキストはすべてこちら。
   上品フォント（セリフ/明朝）は「お金」と「感謝・ブランドの言葉」だけに限定適用する
   （globals.css の .font-elegant ／ 一部の専用クラスで使う）。
   - 英字の上品フォント = Cormorant Garamond（italicも使う・ブランド/ティア名/金額）
   - 和文の上品フォント = 明朝（Shippori Mincho・感謝コピー）
   CSS変数で globals.css に橋渡しする。 */
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap",
});

const mincho = Shippori_Mincho({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mincho",
  display: "swap",
});

/* 基本のゴシック（和文・読みやすさの主役）。Latinグリフも内包するので英字もこれで足りる。 */
const notoSansJp = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-sans-jp",
  display: "swap",
});

/* ブランドロゴ（echo波紋ワードマーク）の "ech" 用。Outfit 600。 */
const outfit = Outfit({
  subsets: ["latin"],
  weight: ["600"],
  variable: "--font-outfit",
  display: "swap",
});

export const metadata: Metadata = {
  title: "echo - 感謝と評価を、サロンへ",
  description:
    "美容サロンのスタッフへ「ありがとう（感想）」と評価スタンプを届けるアプリ。",
  keywords: ["感謝", "評価", "美容サロン", "スタンプ", "echo"],
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon.ico",
    // ホーム画面アイコン（顧客側＝白バック×ミント3円）。apple-touch-icon 本体。
    apple: "/icons/echo-light-180.png",
  },
  openGraph: {
    title: "echo - 感謝と評価を、サロンへ",
    description: "美容サロンのスタッフへ感謝と評価を届けるアプリ。",
    type: "website",
    locale: "ja_JP",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#FFFEFC",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${cormorant.variable} ${mincho.variable} ${notoSansJp.variable} ${outfit.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
