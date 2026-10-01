/**
 * オーナー招待（migration 0050 `public.owner_invites`・§21 コミット5 方式 P）の共通部品。
 *
 * 発行・一覧は /admin/owner-invites（5d・echo Labs 運営者のみ）、消費は /owner/join（5e）。
 *
 * ★コードの形式・生成・正規化・期限・状態判定はサロン招待と同じ★
 *   `@/lib/salon-invite` の純粋な関数をそのまま使う（**salon-invite.ts は変更しない**）。
 *   有効期限 14日もサロン招待と揃える（§21「2026-09-24 決定」5＝まとめて送るため）。
 *   DB を触る checkInviteCode / consumeInvite は salon_invites 専用なので使わない
 *   （オーナー招待の消費は RPC `consume_owner_invite`・5e）。
 *
 * コードは「持っていればオーナーになれる」秘密値。ログ・URL・エラーメッセージに出さない。
 */
export {
  createInviteCode,
  formatInviteCode,
  inviteExpiryISO,
  inviteState,
  normalizeInviteCode,
  type InviteState,
} from "@/lib/salon-invite";

/**
 * 使えなくなったコード（使用済み・期限切れ）の表示用。末尾4文字だけを残す。
 * 一覧で全文を見せるのは未使用のものだけ（2026-10-01 決定・§21 5d）。
 */
export function maskInviteCode(code: string): string {
  return `••••-••••-${code.slice(-4)}`;
}
