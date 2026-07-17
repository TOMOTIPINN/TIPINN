import type { Metadata } from "next";

/**
 * /dashboard 配下のセグメント layout（アイコンのロール別分離のみ）。
 *
 * /dashboard は店長(manager)専用の数字管理ダッシュボード＝業務用。root から light（顧客アイコン）を
 * 継承してしまうため、ここで apple-touch-icon を mint（業務側）に上書きする。
 * icon:favicon も併記して root と構造を揃える（icons 上書きで favicon link が消えるのを防ぐ）。
 *
 * manifest は /manifest-dashboard.json（start_url:"/dashboard"）に上書き＝独立 PWA 化。
 * root の /manifest.json（start_url:"/"）を継承すると、iOS 17.4+ の standalone 起動が
 * 顧客トップ "/" に着地してしまう（/kiosk と同型の落とし穴）。scalar 最深優先で <link rel=manifest> は1本。
 * per-salon 不要（start_url 固定・DBアクセスなし）＝静的 metadata で足りる。
 * DOM ラッパーは足さない（pass-through）。
 */
export const metadata: Metadata = {
  manifest: "/manifest-dashboard.json",
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
