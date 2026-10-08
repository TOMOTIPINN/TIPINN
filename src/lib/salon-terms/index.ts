import type { ComponentType } from "react";

/**
 * サロン向け利用規約の版と本文の台帳（40_decisions.md §26 決定4・C2）。
 *
 * ★本文の置き場所はこのディレクトリ（src/lib/salon-terms/）★
 *   版ごとに1ファイル（例: `v2026-10-14.tsx`。本文を返すコンポーネントを default export）を置き、
 *   下の `SALON_TERMS_BODIES` に1行足す。公開ページ（/terms/salon・/terms/salon/[version]）は
 *   この台帳だけを読む。DB は読まない。
 *
 * ★一度公開した版の本文は変えない★
 *   誤字の修正でも、句読点ひとつでも、**新しい版（新しいファイル＋台帳の1行）を足す**。
 *   既存の版のファイルは書き換えも削除もしない。
 *   理由: 同意の記録（organization_terms_acceptances.terms_version・migration 0051）は版の文字列だけを持つ。
 *   版の中身が後から変わると、「その版に同意した」という記録が何を指すのか分からなくなる。
 *
 * ★版の形式は確定日の日付（YYYY-MM-DD）★
 *   DB の CHECK（organization_terms_acceptances_version_format）と同じ式。ここで形式を外すと、
 *   C3 で同意を記録するときに RPC が invalid_terms を返す。
 *
 * C5（本文の差し込み）でやること:
 *   1. 本文: このディレクトリに `v<版>.tsx` を足す（1か所）
 *   2. 版:   この下の `SALON_TERMS_BODIES` に1行足し、`SALON_TERMS_VERSION` をその版にする（このファイルの中）
 *   `SALON_TERMS_VERSION` の型は台帳のキーなので、台帳に無い版を指すと型エラーになる。
 */

/** 版の形式。DB の CHECK（0051）と同じ。 */
export const SALON_TERMS_VERSION_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/**
 * 版 → 本文。**追記だけ**（既存の行は変えない・消さない）。
 * 2026-10-08 時点では空（本文は山口先生が改訂中・10/14 確定予定）。
 */
const SALON_TERMS_BODIES = {} as const satisfies Record<string, ComponentType>;

export type SalonTermsVersion = keyof typeof SALON_TERMS_BODIES;

/**
 * 現在の版（同意を取る版・/terms/salon に出す版）。
 * **null の間は閉じる側に倒す**: /terms/salon は「準備中」を出す。
 * C3 では /owner/join が同意欄を出さず、RPC も呼ばない（§26 決定4）。
 */
export const SALON_TERMS_VERSION: SalonTermsVersion | null = null;

/** 公開済みの版の一覧（/terms/salon/[version] の静的生成用）。 */
export function listSalonTermsVersions(): string[] {
  return Object.keys(SALON_TERMS_BODIES);
}

/**
 * 版の本文を引く。台帳に無い版・形式が違う値は null（呼び出し側で 404）。
 * パスから来る値なので、形式を見てから、台帳に**自分で持っているキー**だけを引く
 * （`constructor` などの継承プロパティを拾わない＝Object.hasOwn）。
 */
export function getSalonTermsBody(version: string): ComponentType | null {
  if (!SALON_TERMS_VERSION_PATTERN.test(version)) return null;
  if (!Object.hasOwn(SALON_TERMS_BODIES, version)) return null;
  return (SALON_TERMS_BODIES as Record<string, ComponentType>)[version];
}
