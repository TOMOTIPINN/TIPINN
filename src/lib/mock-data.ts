// MVP用モックデータ（後でSupabaseに移行）

export interface Salon {
  id: string;
  name: string;
  slug: string;
  logoUrl: string;
}

export interface Stylist {
  id: string;
  salonId: string;
  name: string;
  slug: string;
  avatarUrl: string;
  message: string;
  thankYouMessage: string;
  isActive: boolean;
}

export interface TipOption {
  amount: number;
  emoji: string;
  label: string;
  description: string;
  isPopular?: boolean;
}

export const SALON: Salon = {
  id: "salon-001",
  name: "CARTA",
  slug: "carta",
  logoUrl: "/logo.png",
};

export const STYLISTS: Stylist[] = [
  {
    id: "stylist-001",
    salonId: "salon-001",
    name: "まりあ",
    slug: "maria",
    avatarUrl: "/stylists/maria.jpg",
    message:
      "いつもご来店ありがとうございます！みなさまからの応援が、もっと良い技術を磨くモチベーションになります ✨",
    thankYouMessage:
      "温かい応援、本当にありがとうございます！もっともっと素敵なスタイルを提案できるように頑張ります💕",
    isActive: true,
  },
  {
    id: "stylist-002",
    salonId: "salon-001",
    name: "のの",
    slug: "nono",
    avatarUrl: "/stylists/nono.jpg",
    message:
      "お客様の笑顔が一番の喜びです！いただいた応援は、技術向上のための研修費に充てさせていただきます 🌸",
    thankYouMessage:
      "ありがとうございます！次回もさらに素敵にしますね！🌟",
    isActive: true,
  },
  {
    id: "stylist-003",
    salonId: "salon-001",
    name: "ちさと",
    slug: "chisato",
    avatarUrl: "/stylists/chisato.jpg",
    message:
      "カラーリングが得意です！応援いただいたお気持ちは、新しいカラー剤の研究に使わせていただきます 🎨",
    thankYouMessage: "嬉しいです！またお会いできるのを楽しみにしています✨",
    isActive: true,
  },
  {
    id: "stylist-004",
    salonId: "salon-001",
    name: "かずね",
    slug: "kazune",
    avatarUrl: "/stylists/kazune.jpg",
    message: "ハサミの研ぎ代として、応援いただけると嬉しいです！最高の切れ味でカットします ✂️",
    thankYouMessage: "応援ありがとうございます！次のカットも楽しみにしていてくださいね💪",
    isActive: true,
  },
  {
    id: "stylist-005",
    salonId: "salon-001",
    name: "あかり",
    slug: "akari",
    avatarUrl: "/stylists/akari.jpg",
    message: "ヘッドスパが得意です！いただいた応援で、もっと気持ちいい施術ができるよう頑張ります 💆‍♀️",
    thankYouMessage: "心からありがとうございます！癒しの時間をもっとお届けしますね🍀",
    isActive: true,
  },
  {
    id: "stylist-006",
    salonId: "salon-001",
    name: "たくま",
    slug: "takuma",
    avatarUrl: "/stylists/takuma.jpg",
    message: "メンズカットならお任せください！応援がさらなる技術向上の糧になります 💈",
    thankYouMessage: "ありがとうございます！かっこよく仕上げますよ！🔥",
    isActive: true,
  },
  {
    id: "stylist-007",
    salonId: "salon-001",
    name: "てり",
    slug: "teri",
    avatarUrl: "/stylists/teri.jpg",
    message: "トレンドスタイルが好きです！応援で最新の技術セミナーに参加させていただきます 📚",
    thankYouMessage: "温かいお気持ち感謝です！最新のスタイルお見せしますね✨",
    isActive: true,
  },
  {
    id: "stylist-008",
    salonId: "salon-001",
    name: "むーちょ",
    slug: "mucho",
    avatarUrl: "/stylists/ayumu.jpg",
    message: "パーマスタイルならお任せ！いただいた応援で新しい技術を磨きます 🌀",
    thankYouMessage: "応援ありがとうございます！もっと素敵に仕上げますね💫",
    isActive: true,
  },
  {
    id: "stylist-009",
    salonId: "salon-001",
    name: "さがべー",
    slug: "sagabe",
    avatarUrl: "/stylists/yu.jpg",
    message: "お客様の理想を形にするのが大好きです！応援お待ちしています 🙌",
    thankYouMessage: "ありがとうございます！これからも頑張ります！😊",
    isActive: true,
  },
  {
    id: "stylist-010",
    salonId: "salon-001",
    name: "こゆき",
    slug: "koyuki",
    avatarUrl: "/stylists/manami.jpg",
    message: "繊細なカットが得意です！応援でもっと良いハサミを手に入れたいです ✨",
    thankYouMessage: "本当にありがとうございます！精一杯頑張ります🌸",
    isActive: true,
  },
  {
    id: "stylist-011",
    salonId: "salon-001",
    name: "あみ",
    slug: "ami",
    avatarUrl: "/stylists/ami.jpg",
    message: "お客様に寄り添ったスタイル提案を心がけています！応援よろしくお願いします 🌟",
    thankYouMessage: "温かい応援ありがとうございます！もっと頑張ります💖",
    isActive: true,
  },
];

export const TIP_OPTIONS: TipOption[] = [
  {
    amount: 200,
    emoji: "🍦",
    label: "ありがとうアイス",
    description: "アイス1個分",
  },
  {
    amount: 500,
    emoji: "🍰",
    label: "ありがとうケーキ",
    description: "ケーキ1個分",
    isPopular: true,
  },
  {
    amount: 1500,
    emoji: "🍽️",
    label: "ありがとうランチ",
    description: "ランチ1回分",
  },
  {
    amount: 3000,
    emoji: "💐",
    label: "ありがとう花束",
    description: "花束1つ分",
  },
];

export function getStylistBySlug(slug: string): Stylist | undefined {
  return STYLISTS.find((s) => s.slug === slug);
}

export function getStylistById(id: string): Stylist | undefined {
  return STYLISTS.find((s) => s.id === id);
}
