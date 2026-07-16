import type { Metadata } from "next";
import { getDeviceCookie } from "@/lib/device-session";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * /kiosk 配下のセグメント layout（受付端末専用 PWA・独立セグメント）。
 *
 * root layout が全ページ共通で customer 用 `/manifest.json`（start_url:"/"）を配るため、
 * ここで manifest を per-salon 動的 manifest（/kiosk/manifest?salon=&device=）に上書きする。
 * ネスト metadata の scalar は最深セグメント優先で上書き＝<link rel="manifest"> は1本。
 *
 * href に salon/device を載せるのは、manifest route が「{サロン名} 受付」を出し分け＋start_url に
 * token を埋めるため。値は echo_device cookie（setup で発行済み）から署名検証だけして取り出す
 * （DB 突合は manifest route 側でやる）。cookie が無い＝未登録/失効時は staff 用 manifest に退避する
 * （その場合 /kiosk ページは再登録を促すカードを出す）。
 *
 * ホーム画面のアプリ名: iOS は manifest の name ではなく apple-mobile-web-app-title（appleWebApp.title）を
 * 使い、無ければ <title> にフォールバックする。よって per-salon の appleWebApp.title を明示して
 * 「{サロン名} 受付」を出す（Android/Chrome は manifest の name を見るので、manifest route と同じ
 * ソース（salons.name）・同じ文字列にして両者を一致させる）。root/staff/manager/dashboard には付けない。
 *
 * customer 側（root layout / public/manifest.json）・staff/manager 側は一切変更しない。pass-through。
 */
export async function generateMetadata(): Promise<Metadata> {
  // ホーム画面アイコン（業務側＝ミントバック×白）。受付端末は業務用なので root の light を継承させず mint を出す。
  // icon:favicon も併記して root と構造を揃える（icons 上書きで favicon link が消えるのを防ぐ）。
  const icons = {
    icon: "/favicon.ico",
    apple: "/icons/echo-mint-180.png",
  };
  const payload = await getDeviceCookie();
  if (!payload) {
    // 未登録/失効: salon が特定できない。顧客 <title>（"echo - 感謝と…"）に落とさないよう汎用名を出す。
    return {
      manifest: "/manifest-staff.json",
      icons,
      appleWebApp: { title: "echo 受付" },
    };
  }

  // アプリ名は manifest route と同じソース（salons.name）から引く＝ホーム名と manifest.name を一致させる。
  const { data: salon } = await supabaseAdmin
    .from("salons")
    .select("name")
    .eq("id", payload.salon_id)
    .maybeSingle<{ name: string | null }>();
  const salonName = salon?.name?.trim() || "サロン";

  const qs = new URLSearchParams({
    salon: payload.salon_id,
    device: payload.device_token,
  });
  return {
    manifest: `/kiosk/manifest?${qs.toString()}`,
    icons,
    appleWebApp: { title: `${salonName} 受付` },
  };
}

export default function KioskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
