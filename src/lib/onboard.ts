/**
 * 店頭オンボーディング導線のURL単一ソース（[[auth-method-line-b]]）。
 * 顧客の着地（/onboard）と店頭QRの発行（/manager/onboard-qr）で同一の URL を組む。
 *
 * salons.visit_token を再利用する（/visit と同じ照合ガード）。visit_token はサロン作成時に
 * 一度だけ採番され、以降ローテート/再発行されない安定値のため、印刷・常設のQRに使える。
 */

/** 店頭QRに焼く絶対URL（baseUrl込み・QR生成用）。 */
export function onboardUrl(
  baseUrl: string,
  salonId: string,
  visitToken: string,
): string {
  return `${baseUrl}/onboard?salon=${encodeURIComponent(salonId)}&t=${encodeURIComponent(visitToken)}`;
}

/** ログイン往復用の自サイト内ローカルパス（returnTo に載せる・sanitizeReturnTo 互換）。 */
export function onboardPath(salonId: string, visitToken: string): string {
  return `/onboard?salon=${encodeURIComponent(salonId)}&t=${encodeURIComponent(visitToken)}`;
}
