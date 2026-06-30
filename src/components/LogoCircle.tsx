import type { CSSProperties } from "react";

/**
 * ロゴ円の表示用 共有コンポーネント（CLAUDE.md §5 / §8）。
 *
 * ★ このコンポーネントは §8「インラインstyle禁止」の唯一の例外箇所。★
 * 連続値である位置(x/y)・ズーム(zoom)は固定CSSクラスで表現できないため、
 * CSS変数を style 属性で「データ」として渡す（視覚ルール本体は globals.css の
 * `.logo-circle img { transform: ... var(--logo-x) ... }` 側にある）。
 * 他の場所でこの方式を増やさない（StampRing もここを経由する）。
 *
 * x/y は円の幅に対する％、zoom は倍率。サイズ非依存なので、mypage 見出し(40px) /
 * スタンプドット(48px) / 編集プレビュー(大) のどこでも同じトリミングで表示される。
 * 既定 (0,0,1) は無調整＝従来の object-fit:cover と一致（後方互換）。
 *
 * 親（.salon-logo など）が円のサイズ・枠・背景を与え、本コンポーネントはそれを満たす。
 */
export function LogoCircle({
  logoUrl,
  x = 0,
  y = 0,
  zoom = 1,
  fallback,
  className,
}: {
  logoUrl?: string | null;
  x?: number;
  y?: number;
  zoom?: number;
  fallback?: string;
  className?: string;
}) {
  const vars = {
    "--logo-x": `${x}%`,
    "--logo-y": `${y}%`,
    "--logo-zoom": String(zoom),
  } as CSSProperties;

  return (
    <span
      className={["logo-circle", className].filter(Boolean).join(" ")}
      style={vars}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" />
      ) : (
        (fallback ?? null)
      )}
    </span>
  );
}
