import type { Metadata, Viewport } from "next";
import "./globals.css";

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
  themeColor: "#FF6B6B",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
