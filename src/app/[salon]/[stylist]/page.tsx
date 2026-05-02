import { STYLISTS, SALON, TEAM_STYLIST } from "@/lib/mock-data";
import StylistPage from "./StylistPage";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ salon: string; stylist: string }>;
}

// team を含む全スタイリストリスト
const ALL_STYLISTS = [TEAM_STYLIST, ...STYLISTS];

export async function generateStaticParams() {
  return ALL_STYLISTS.map((s) => ({
    salon: SALON.slug,
    stylist: s.slug,
  }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { stylist: stylistSlug } = await params;
  const stylist = ALL_STYLISTS.find((s) => s.slug === stylistSlug);

  if (!stylist) {
    return { title: "tipinn" };
  }

  const isTeam = stylistSlug === "team";

  return {
    title: isTeam
      ? `${SALON.name}全体を応援 | tipinn`
      : `${stylist.name}さんを応援 | ${SALON.name} - tipinn`,
    description: isTeam
      ? `${SALON.name}のチーム全体に感謝の気持ちを伝えよう。QRコードをスキャンするだけで、かんたんにチップを送れます。`
      : `${SALON.name}の${stylist.name}さんに感謝の気持ちを伝えよう。QRコードをスキャンするだけで、かんたんにチップを送れます。`,
    openGraph: {
      title: isTeam
        ? `${SALON.name}全体を応援`
        : `${stylist.name}さんを応援 | ${SALON.name}`,
      description: stylist.message,
      images: [{ url: stylist.avatarUrl }],
    },
  };
}

export default async function Page({ params }: PageProps) {
  const { salon: salonSlug, stylist: stylistSlug } = await params;

  if (salonSlug !== SALON.slug) {
    notFound();
  }

  const stylist = ALL_STYLISTS.find((s) => s.slug === stylistSlug);

  if (!stylist) {
    notFound();
  }

  return <StylistPage stylist={stylist} salon={SALON} />;
}
