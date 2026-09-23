/**
 * 「最近の評価」の読み込み深さ（§20 決定4・2026-09-22）。純関数のみ・DB非依存。
 *
 * ★深さは URL（`?take=`）に持つ（§20 実装前の判断2）★
 *   クライアント state にすると、上限までの顧客名を**最初にまとめてブラウザへ送る**ことになり
 *   原則7（個人情報は必要な分だけ）に反する。URL に持てば、サーバーが take 件だけ引いて返す。
 *   §17（Inbox）・§22（/staff）と同じ「成長する take」＝毎回先頭から take 件を取り直す
 *   （offset で追記しない。`created_at` は一意ではないため・`fetch-all-rows.ts:20-21`）。
 *
 * server（page.tsx が parse）と client（DashboardClient がリンクを作る）の両方から使うので、
 * supabaseAdmin を持つ dashboard-data.ts には置かない（client バンドルに server 依存を混ぜない）。
 */
import type { PeriodKey } from "./period";

/** 1回に表示する件数。初回もこの数で、「もっと見る」1回につきこの数だけ増える。 */
export const RECENT_PAGE_SIZE = 5;

/**
 * take の上限（§20 実装前の判断2）。
 * ダッシュボードの一覧としてはこれで十分で、顧客名を引く `.in()` の要素数も抑えられる
 * （一覧を読み切る画面は /manager/inbox の方）。
 */
export const RECENT_MAX_TAKE = 100;

/**
 * `?take=` を読む。不正値・未指定は1ページ目。
 * ページサイズの倍数に切り上げ、上限で丸める（URL を直接いじられても壊れない）。
 * Inbox の parseTake（`manager/inbox/page.tsx`）と同じ作法。
 */
export function parseRecentTake(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= RECENT_PAGE_SIZE) return RECENT_PAGE_SIZE;
  const rounded = Math.ceil(n / RECENT_PAGE_SIZE) * RECENT_PAGE_SIZE;
  return Math.min(rounded, RECENT_MAX_TAKE);
}

/**
 * 「もっと見る」のリンク先。**いま見ている期間を必ず引き継ぐ**
 * （落とすと「今月」に戻ってしまう）。既定（今月・1ページ目）はクエリ無しの素の URL にする。
 *
 * 逆に PeriodSelector は period だけで URL を組み立てるので、**期間を切り替えると take は落ちて
 * 5件に戻る**（§20 実装前の判断2）。期間が変われば母集団も変わるため、これは意図した挙動。
 */
export function dashboardHref(
  period: { key: PeriodKey; from?: string; to?: string },
  take: number,
): string {
  const params = new URLSearchParams();
  if (period.key !== "month") params.set("period", period.key);
  if (period.key === "custom") {
    if (period.from) params.set("from", period.from);
    if (period.to) params.set("to", period.to);
  }
  if (take !== RECENT_PAGE_SIZE) params.set("take", String(take));
  const q = params.toString();
  return q ? `/dashboard?${q}` : "/dashboard";
}
