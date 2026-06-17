/**
 * echo 波紋ロゴ（ワードマーク・バリアントC「標準間隔 × 強調o」）。
 * "ech" の直後の "o" を同心円の波紋で表現し、ブランドの「響き」を主役にする。
 *
 * - viewBox + 相対値で組んでいるので、size を変えるだけで看板〜ファビコン級まで
 *   破綻なくスケールする（内部座標は固定・拡大縮小は SVG が担う）。
 * - tone でライト/ダーク背景に両対応（テキスト色のみ切替、波紋teal は共通）。
 * - "ech" は Outfit 600（layout.tsx で読込・CSS変数 --font-outfit）。
 *   未適用時は system-ui 等にフォールバックする。その場合 "ech" の実描画幅が
 *   変わり o との間隔が僅かにずれ得るが、座標系は固定なのでレイアウトは破綻しない。
 *
 * バリアント値: oScale = 12 / gap係数 = 0.12（波紋をひと回り大きめに＝響きを主役に）。
 */

const FONT_SIZE = 48; // 基準フォントサイズ（座標系の基準。表示倍率は size で決まる）
const O_SCALE = 12; // バリアントC基準の波紋スケール
const BASELINE = 50; // "ech" のベースライン y

/* Outfit 600 における "ech" のおおよその送り幅（fontSize比 ≒ 1.666）。
   フォント差し替え等で間隔を微調整したい場合はここだけ触る。 */
const ECH_WIDTH = 80;

const PAD = 8; // viewBox の余白
const GAP = FONT_SIZE * 0.12 + O_SCALE; // "ech"右端 → o中心 の間隔
const O_CX = PAD + ECH_WIDTH + GAP; // o（波紋）の中心 x
const O_CY = BASELINE - FONT_SIZE * 0.26; // o の中心 y（ベースラインより上）

const R_FILL = O_SCALE * 0.9; // 中心の塗り円
const R_RING1 = O_SCALE * 1.65; // 内側リング
const R_RING2 = O_SCALE * 2.45; // 外側リング
const RING_W = 3.2; // リングの線幅

// 波紋の外側リングまで収まるよう viewBox を算出（右下端 + 余白）
const VB_W = O_CX + R_RING2 + PAD;
const VB_H = O_CY + R_RING2 + PAD;
const ASPECT = VB_W / VB_H;

// 配色
const TEAL = "#11A697";
const INK_LIGHT = "#15202B"; // ライト背景時のテキスト
const INK_DARK = "#FBFAF7"; // ダーク背景時のテキスト

export function EchoLogo({
  size = 56,
  tone = "light",
  className,
  title = "echo",
}: {
  /** 表示高さ(px)。幅はアスペクト比から自動算出。 */
  size?: number;
  /** 背景トーン。テキスト色を切り替える（波紋は共通）。 */
  tone?: "light" | "dark";
  className?: string;
  /** アクセシブルネーム兼ツールチップ。 */
  title?: string;
}) {
  const textColor = tone === "dark" ? INK_DARK : INK_LIGHT;
  const width = size * ASPECT;

  return (
    <svg
      className={className ? `echo-logo ${className}` : "echo-logo"}
      width={width}
      height={size}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>

      {/* ワードマーク "ech" */}
      <text
        className="echo-logo-text"
        x={PAD}
        y={BASELINE}
        fontSize={FONT_SIZE}
        fill={textColor}
      >
        ech
      </text>

      {/* "o" を表す波紋（同心円） */}
      <g>
        <circle cx={O_CX} cy={O_CY} r={R_FILL} fill={TEAL} />
        <circle
          cx={O_CX}
          cy={O_CY}
          r={R_RING1}
          fill="none"
          stroke={TEAL}
          strokeWidth={RING_W}
          opacity={0.7}
        />
        <circle
          cx={O_CX}
          cy={O_CY}
          r={R_RING2}
          fill="none"
          stroke={TEAL}
          strokeWidth={RING_W}
          opacity={0.4}
        />
      </g>
    </svg>
  );
}
