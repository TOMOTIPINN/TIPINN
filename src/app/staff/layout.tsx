import type { Metadata } from "next";

/**
 * /staff 配下のセグメント layout（PWA start_url のロール別分離・不具合 #3 対策）。
 *
 * root layout（src/app/layout.tsx）が全ページ共通で customer 用 `/manifest.json`
 * （start_url:"/"）を配るため、staff がホーム画面保存しても iOS16.4+ は start_url に
 * 従って顧客ホーム "/" から起動してしまう。ここで manifest を staff 用に上書きし、
 * /staff 配下の頁では start_url:"/staff" の manifest を配る（ネスト metadata は
 * scalar フィールドを最深セグメント優先で上書き＝<link rel="manifest"> は1本）。
 *
 * customer 側（root layout / public/manifest.json）は一切変更しない。
 * DOM ラッパーは足さない（pass-through）。
 */
export const metadata: Metadata = {
  manifest: "/manifest-staff.json",
  // ホーム画面アイコン（業務側＝ミントバック×白）。manifest 指定はそのまま維持。
  // icons を上書きするとfavicon linkが消えるため icon:favicon も併記して root と構造を揃える。
  icons: {
    icon: "/favicon.ico",
    apple: "/icons/echo-mint-180.png",
  },
};

export default function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
