import type { Metadata } from "next";

/**
 * /manager 配下のセグメント layout（PWA start_url のロール別分離・不具合 #3 対策）。
 *
 * manager も staff 世界の住人（/staff に入れる）。ホーム保存の起動先は専用 manifest を
 * 別立てせず、staff 用 manifest（start_url:"/staff"）に集約する（サロン世界の共通入口）。
 * 顧客ホーム "/" から起動する回帰を防ぐのが目的。詳細は src/app/staff/layout.tsx を参照。
 *
 * customer 側（root layout / public/manifest.json）は一切変更しない。pass-through。
 */
export const metadata: Metadata = {
  manifest: "/manifest-staff.json",
};

export default function ManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
