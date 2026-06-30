/**
 * echo 共有UIコンポーネント（CLAUDE.md §5 / §8）。
 * インラインstyleは使わず、globals.css のトークン/クラスにのみ依存する。
 * 視覚デザインの単一の入口。新画面はここの Card / Button / Eyebrow を使う。
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { LogoCircle } from "@/components/LogoCircle";

/* 英字 italic serif の小さなアイブロウラベル（G2.5）。
   例: <Eyebrow>Share your feedback</Eyebrow> */
export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <p className={cx("eyebrow", className)}>{children}</p>;
}

/* 白世界のカード。淡いシャドウ＋角丸。 */
export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cx("card", className)}>{children}</div>;
}

/* 貯まるスタンプの円リング（画面06/07/10 共通）。
   count個ぶん点灯し、残りは破線。点灯部はサロンの円形ロゴ（位置/ズーム調整を反映）、
   無ければ頭文字フォールバック。ロゴ描画は LogoCircle に委譲（§8の例外はそこに一本化）。 */
export function StampRing({
  count,
  size,
  logoUrl,
  fallback,
  logoX = 0,
  logoY = 0,
  logoZoom = 1,
}: {
  count: number;
  size: number;
  logoUrl?: string | null;
  fallback?: string;
  logoX?: number;
  logoY?: number;
  logoZoom?: number;
}) {
  const filled = Math.min(count, size);
  return (
    <div className="stamp-ring" aria-label={`貯まるスタンプ ${count} 個`}>
      {Array.from({ length: size }).map((_, i) => {
        const isFilled = i < filled;
        return (
          <span
            key={i}
            className={cx("stamp-dot", isFilled && "is-filled")}
            aria-hidden="true"
          >
            {isFilled
              ? logoUrl
                ? <LogoCircle
                    logoUrl={logoUrl}
                    x={logoX}
                    y={logoY}
                    zoom={logoZoom}
                  />
                : (fallback ?? null)
              : null}
          </span>
        );
      })}
    </div>
  );
}

/* VIP到達バッジ。無料感想スタンプが1サイクル（CYCLE_SIZE個）に到達したら点灯。
   一度点いたら以降ずっと点灯したまま（isVIP は stampCount が減らない限り true）。
   判定は @/lib/vip の computeVipProgress に集約。§5 準拠（鮮やかな塗りは使わず墨色チップ）。 */
export function VipBadge({ className }: { className?: string }) {
  return (
    <span className={cx("vip-badge", className)} aria-label="VIP">
      VIP
    </span>
  );
}

type ButtonVariant = "outline" | "quiet";

/* 控えめなボタン。鮮やかな塗りは使わない（§5）。
   - outline: 主アクション（細枠ピル）
   - quiet:   テキスト的な最小アクション */
export function Button({
  variant = "outline",
  block,
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  block?: boolean;
}) {
  return (
    <button
      type={type}
      className={cx(
        "btn",
        variant === "outline" ? "btn-outline" : "btn-quiet",
        block && "btn-block",
        className,
      )}
      {...rest}
    />
  );
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
