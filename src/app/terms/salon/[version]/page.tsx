import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  SALON_TERMS_VERSION,
  getSalonTermsBody,
  listSalonTermsVersions,
} from "@/lib/salon-terms";
import SalonTermsDocument from "../SalonTermsDocument";

/**
 * サロン向け利用規約・版ごとの固定 URL（/terms/salon/[version]・白世界）。
 * **認証不要の公開ページ**（§26 決定4・C2）。DB は読まない。
 *
 * 同意の記録（organization_terms_acceptances.terms_version）が指す本文は、この URL で読める。
 * **一度公開した版の本文は変えない**（`@/lib/salon-terms` の冒頭）ので、URL の中身も変わらない。
 *
 * ★台帳に無い版は 404★
 *   `dynamicParams = false` で、`generateStaticParams` が返さない版はルートごと 404。
 *   念のため page 側でも台帳を引き、無ければ notFound()（形式違い・継承プロパティ名も同じ 404）。
 *   2026-10-08 時点では台帳が空なので、すべての版が 404。
 *
 * 導線: どの画面からもリンクしない（C3 で /owner/join の同意欄から張る）。
 */
export const dynamicParams = false;

export function generateStaticParams(): { version: string }[] {
  return listSalonTermsVersions().map((version) => ({ version }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ version: string }>;
}): Promise<Metadata> {
  const { version } = await params;
  return {
    title: `サロン向け利用規約（${version} 版） - echo`,
    description: `echo のサロン向け利用規約（${version} 版）。`,
  };
}

export default async function SalonTermsVersionPage({
  params,
}: {
  params: Promise<{ version: string }>;
}) {
  const { version } = await params;

  const Body = getSalonTermsBody(version);
  if (!Body) {
    notFound();
  }

  return (
    <SalonTermsDocument
      version={version}
      Body={Body}
      isCurrent={version === SALON_TERMS_VERSION}
    />
  );
}
