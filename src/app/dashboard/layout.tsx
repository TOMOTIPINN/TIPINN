import type { Metadata } from "next";

/**
 * /dashboard 配下のセグメント layout（アイコンのロール別分離のみ）。
 *
 * /dashboard は店長(manager)専用の数字管理ダッシュボード＝業務用。root から light（顧客アイコン）を
 * 継承してしまうため、ここで apple-touch-icon を mint（業務側）に上書きする。
 * icon:favicon も併記して root と構造を揃える（icons 上書きで favicon link が消えるのを防ぐ）。
 *
 * manifest は指定しない＝root の /manifest.json をそのまま継承する（manifest 3層構造は無変更）。
 * DOM ラッパーは足さない（pass-through）。
 */
export const metadata: Metadata = {
  icons: {
    icon: "/favicon.ico",
    apple: "/icons/echo-mint-180.png",
  },
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
