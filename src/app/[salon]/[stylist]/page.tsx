import { STYLISTS, SALON, TEAM_STYLIST } from "@/lib/mock-data";
import { supabase } from "@/lib/supabase";
import StylistPage from "./StylistPage";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ salon: string; stylist: string }>;
}

// Supabaseからスタイリストを取得（フォールバック付き）
async function getStylist(slug: string) {
  try {
    const { data, error } = await supabase
      .from("stylists")
      .select("*")
      .eq("slug", slug)
      .eq("is_active", true)
      .single();

    if (error || !data) throw new Error("Not found");

    // DBのカラム名をフロントエンド用に変換
    return {
      id: data.id,
      salonId: data.salon_id,
      name: data.name,
      slug: data.slug,
      avatarUrl: data.avatar_url,
      message: data.message,
      thankYouMessage: data.thank_you_message,
      isActive: data.is_active,
    };
  } catch {
    // フォールバック: mock-data
    const allStylists = [TEAM_STYLIST, ...STYLISTS];
    return allStylists.find((s) => s.slug === slug) || null;
  }
}

export async function generateStaticParams() {
  const allStylists = [TEAM_STYLIST, ...STYLISTS];
  return allStylists.map((s) => ({
    salon: SALON.slug,
    stylist: s.slug,
  }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { stylist: stylistSlug } = await params;
  const stylist = await getStylist(stylistSlug);

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

export const revalidate = 60; // 60秒ごとにデータを再取得（ISR）

export default async function Page({ params }: PageProps) {
  const { salon: salonSlug, stylist: stylistSlug } = await params;

  if (salonSlug !== SALON.slug) {
    notFound();
  }

  const stylist = await getStylist(stylistSlug);

  if (!stylist) {
    notFound();
  }

  return <StylistPage stylist={stylist} salon={SALON} />;
}
