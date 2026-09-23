import { trendDir } from "./eval-data";

/**
 * 前期間比の表示（§12 ステータス配色）。
 *
 * ★`/dashboard` と `/owner` で同じものを使うために切り出した（§21 コミット3d-1）★
 *   以前は `DashboardClient.tsx` の中にあった。文言・クラス・計算は**そのまま**。
 *
 * 配色: **上昇＝ミント（`.trend-up`）／横ばい・下降＝既定グレー**。
 *   **赤は使わない**（`30_design.md` §2）。下降を目立たせない＝店舗やスタッフを
 *   「低い方」で強調しない（§4.4 / §4.5）。
 *
 * `"use client"` は付けない（hooks を持たない純粋な表示）。
 *   client からも server からも import できる。
 */

/** 前期間比（0除算ガード。符号付き整数%）。 */
export function pct(prev: number, cur: number): string {
  if (prev <= 0) return "—";
  const d = Math.round(((cur - prev) / prev) * 100);
  return (d >= 0 ? "+" : "") + d + "%";
}

export default function DeltaPct({ prev, cur }: { prev: number; cur: number }) {
  const up = trendDir(prev, cur) === "up";
  return <span className={up ? "trend-up" : undefined}>{pct(prev, cur)}</span>;
}
