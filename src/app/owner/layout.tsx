import type { Metadata } from "next";

/**
 * /owner 配下のセグメント layout（PWA start_url のロール別分離＋業務側アイコン）。
 *
 * root の /manifest.json（start_url:"/"）を継承すると、/owner でホーム画面に追加しても
 * iOS 17.4+ の standalone 起動が顧客トップ "/" に着地してしまう（/dashboard と同型の落とし穴）。
 * ここで manifest を /manifest-owner.json（start_url・scope:"/owner"）に上書き＝独立 PWA 化。
 * scalar 最深優先で <link rel=manifest> は1本。per-salon 不要＝静的 metadata で足りる。
 *
 * アプリ名: 新経路は manifest.name、旧経路は apple-mobile-web-app-title を使うため
 * 両方を「echo owner」にそろえる（40_decisions.md §5.1）。
 * icons は root から light（顧客アイコン）を継承してしまうため mint（業務側）に上書きする。
 * icon:favicon も併記して root と構造を揃える（icons 上書きで favicon link が消えるのを防ぐ）。
 *
 * 認可は置かない（各 page の requireOwnerPage / requireOwnerSalon が持つ・owner-guard.ts）。
 * customer 側（root layout / public/manifest.json）は一切変更しない。DOM ラッパーは足さない（pass-through）。
 */
export const metadata: Metadata = {
  manifest: "/manifest-owner.json",
  appleWebApp: { title: "echo owner" },
  icons: {
    icon: "/favicon.ico",
    apple: "/icons/echo-mint-180.png",
  },
};

export default function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
