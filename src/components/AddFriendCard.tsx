/**
 * スタッフホーム（/staff）の LINE 公式アカウント 友だち追加リンク（控えめ・常設・1行）。
 *
 * 趣旨: ホーム画面 PWA アイコンを失っても、公式アカウントを恒久的な入口として残す補助動線。
 *   主動線（来店受付）より目立たせないため、カードではなく .note-fine 相当の小さめ・低コントラストな
 *   1行テキストリンクにする。一度きりの補助のため dismissible は持たず常時表示（＝いつでも気づける）。
 *
 * - URL は server（/staff）が env（NEXT_PUBLIC_LINE_ADD_FRIEND_URL）から解決して渡す。
 *   env 未設定なら server 側でこの要素自体を出さない（安全側）。
 * - 外部リンク（line.me / lin.ee）なので target=_blank rel=noopener を維持。
 * - スタイルは既存クラスのみ（.note-fine）。インラインstyle無し（§8）。client 機能は不要。
 */
export default function AddFriendCard({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="note-fine">
      公式アカウントを友だち追加 →
    </a>
  );
}
