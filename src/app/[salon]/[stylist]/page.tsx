import { STYLISTS, SALON } from "@/lib/mock-data";
import StylistPage from "./StylistPage";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ salon: string; stylist: string }>;
}

export async function generateStaticParams() {
  return STYLISTS.map((s) => ({
    salon: SALON.slug,
    stylist: s.slug,
  }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { stylist: stylistSlug } = await params;
  const stylist = STYLISTS.find((s) => s.slug === stylistSlug);

  if (!stylist) {
    return { title: "tipinn" };
  }

  return {
    title: `${stylist.name}さんを応援 | ${SALON.name} - tipinn`,
    description: `${SALON.name}の${stylist.name}さんに感謝の気持ちを伝えよう。QRコードをスキャンするだけで、かんたんにチップを送れます。`,
    openGraph: {
      title: `${stylist.name}さんを応援 | ${SALON.name}`,
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

  const stylist = STYLISTS.find((s) => s.slug === stylistSlug);

  if (!stylist) {
    notFound();
  }

  return <StylistPage stylist={stylist} salon={SALON} />;
}
