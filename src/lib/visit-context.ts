import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";
import { getDeviceContext } from "@/lib/device-session";

/**
 * 来店受付（/staff/visit・/api/staff/visit）の salon スコープ解決（[[auth-method-line-b]]）。
 *
 * 2経路を統合する。どちらでも「使う salon_id は1つ」に畳み込まれ、下流（記録RPC）は無改修で動く。
 *   1. スタッフ経路（温存）: LINEログイン中で staff に紐付く人 → その ctx.salon_id。role は問わない。
 *   2. 端末経路（追加）    : LINE無しでも、有効な device_token cookie があれば その salon_id。
 *
 * 優先はスタッフ経路（本人ログインが最も確か）。無ければ端末経路にフォールバックする。
 * どちらも無ければ null（未認証）。
 *
 * source は表示用（端末バナー出し分け）にのみ使う。記録は元々匿名（visits に staff_id 列なし・0009）で、
 * どちらの経路でも操作スタッフは残さない。
 */
export type VisitContext = {
  salon_id: string;
  source: "staff" | "device";
};

export async function getVisitContext(): Promise<VisitContext | null> {
  // 1) スタッフ経路（既存挙動の温存）
  const session = await getSession();
  if (session) {
    const ctx = await getStaffContext();
    if (ctx) return { salon_id: ctx.salon_id, source: "staff" };
  }

  // 2) 端末経路（LINE無し・据え置きiPad）
  const device = await getDeviceContext();
  if (device) return { salon_id: device.salon_id, source: "device" };

  return null;
}
