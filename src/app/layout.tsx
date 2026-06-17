import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Shippori_Mincho } from "next/font/google";
import "./globals.css";

/* §5 デザインシステムのフォント。
   英字/見出し/アイブロウ = Cormorant Garamond（italicも使う）
   和文 = 明朝（Shippori Mincho）。CSS変数で globals.css に橋渡しする。 */
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

export const metadata: Metadata = {
  title: "echo - 感謝と評価を、サロンへ",
  description:
    "美容サロンのスタッフへ「ありがとう（感想）」と評価スタンプを届けるアプリ。",
  keywords: ["感謝", "評価", "美容サロン", "スタンプ", "echo"],
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon.ico",
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
    <html lang="ja" className={`${cormorant.variable} ${mincho.variable}`}>
      <body>{children}</body>
    </html>
  );
}
