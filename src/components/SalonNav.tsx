"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import RoleBar, { type SalonRole } from "@/components/RoleBar";

/**
 * サロン（店長）UI の共通ナビ。数字管理トップ〜声〜スタッフを1本で行き来する。
 *
 * - /dashboard は /manager 配下ではない別ルートのため、layout ではなく「置くだけ」の
 *   client コンポーネントとして各ページ上部に手挿しする（§12 サロンUI・ミントのアクティブ表現）。
 * - 第一階層は 数字管理 / 声の一覧 / スタッフ の3つ。初期設定系（店舗/特典/来店）は
 *   「設定」ドロップダウンに集約（/manager/settings ハブは後回し）。
 * - アクティブ判定は usePathname。スタイルは globals.css（.salon-nav*）。インラインstyle無し（§8）。
 */

type NavItem = { href: string; label: string; match: (p: string) => boolean };

const PRIMARY: NavItem[] = [
  { href: "/dashboard", label: "数字管理", match: (p) => p === "/dashboard" },
  {
    href: "/manager/inbox",
    label: "声の一覧",
    match: (p) => p.startsWith("/manager/inbox"),
  },
  {
    href: "/manager/staff",
    label: "スタッフ",
    match: (p) => p.startsWith("/manager/staff"),
  },
  {
    // 来店受付＝店頭の日次オペ。staff/manager どちらでも開ける（/staff/visit 側でガード）。
    href: "/staff/visit",
    label: "来店受付",
    match: (p) => p.startsWith("/staff/visit"),
  },
];

const SETTINGS: NavItem[] = [
  {
    href: "/manager/profile",
    label: "店舗プロフィール",
    match: (p) => p.startsWith("/manager/profile"),
  },
  {
    href: "/manager/rewards",
    label: "特典設定",
    match: (p) => p.startsWith("/manager/rewards"),
  },
  {
    href: "/manager/visit",
    label: "来店設定",
    match: (p) => p.startsWith("/manager/visit"),
  },
  {
    href: "/manager/kiosk",
    label: "受付端末",
    match: (p) => p.startsWith("/manager/kiosk"),
  },
  {
    href: "/manager/onboard-qr",
    label: "店頭QR",
    match: (p) => p.startsWith("/manager/onboard-qr"),
  },
];

export default function SalonNav({ role }: { role: SalonRole }) {
  const pathname = usePathname() ?? "";
  const settingsActive = SETTINGS.some((i) => i.match(pathname));
  const [open, setOpen] = useState(settingsActive);

  return (
    <nav className="salon-nav" aria-label="サロン管理ナビ">
      {/* 上部ロールバー（§12）。権限を斜体英字＋--accent で示す。customer には出ない。 */}
      <RoleBar role={role} />
      <div className="salon-nav-bar">
        {/* 主ナビ＝3タブを独立したピルグループとして横1段に */}
        <div className="salon-nav-row">
          {PRIMARY.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`salon-nav-link${item.match(pathname) ? " is-active" : ""}`}
              aria-current={item.match(pathname) ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </div>

        {/* 設定＝主ナビの括りから外し、右端に歯車で分離 */}
        <button
          type="button"
          className={`salon-nav-gear${settingsActive ? " is-active" : ""}`}
          aria-label="設定"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span aria-hidden="true">⚙</span>
        </button>
      </div>

      {open && (
        <div className="salon-nav-settings" role="group" aria-label="初期設定">
          {SETTINGS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`salon-nav-sublink${item.match(pathname) ? " is-active" : ""}`}
              aria-current={item.match(pathname) ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
