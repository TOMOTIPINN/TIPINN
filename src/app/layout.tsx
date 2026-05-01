import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "tipinn - 感謝を届ける、新しいカタチ",
  description:
    "美容室でのスタイリングに感謝の気持ちを伝えよう。QRコードをスキャンするだけで、かんたんにチップを送れます。",
  keywords: ["チップ", "美容室", "感謝", "応援", "PayPay", "tipinn"],
  manifest: "/manifest.json",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
  openGraph: {
    title: "tipinn - 感謝を届ける、新しいカタチ",
    description: "美容室でのスタイリングに感謝の気持ちを伝えよう。",
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
