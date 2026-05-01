// サイト全体の表示テキスト設定（管理画面から編集可能）
// お客様に見えるすべての文言をここで一元管理

export interface SiteConfig {
  // ホームページ
  home: {
    heroEmoji: string;
    heroTitle1: string;
    heroTitle2: string;
    heroSubtitle1: string;
    heroSubtitle2: string;
    sectionTitle: string;
    sectionIcon: string;
    teamName: string;
    teamDesc: string;
    ctaButtonText: string;
    ctaNote: string;
  };

  // スタイリスト個別ページ（ランディング）
  stylistLanding: {
    greeting1: string;
    greeting2: string;
    messageIcon: string;
    ctaButtonEmoji: string;
    ctaButtonText: string;
    ctaSubtext: string;
  };

  // チップ選択ページ
  tipSelection: {
    title1: string;
    title2: string;
    customAmountLabel: string;
    messageSectionTitle: string;
    messagePlaceholder: string;
    nameSectionTitle: string;
    namePlaceholder: string;
    totalLabel: string;
    payButtonText: string;
    minAmountNote: string;
  };

  // お礼ページ
  thanksPage: {
    heartEmoji: string;
    title1: string;
    title2: string;
    amountSuffix: string;
    fromSuffix: string;
    shareText: string;
    returnButtonText: string;
  };

  // チップ選択肢
  tipOptions: {
    amount: number;
    emoji: string;
    label: string;
    description: string;
    isPopular?: boolean;
  }[];
}

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  home: {
    heroEmoji: "💝",
    heroTitle1: "今日の感謝を",
    heroTitle2: "カタチにしよう",
    heroSubtitle1: "担当スタイリストに、",
    heroSubtitle2: "ありがとうの気持ちを届けませんか？",
    sectionTitle: "今日担当したスタッフ",
    sectionIcon: "✨",
    teamName: "箱推し！",
    teamDesc: "CARTA全体を応援",
    ctaButtonText: "応援する",
    ctaNote: "登録不要・アプリダウンロード不要",
  },

  stylistLanding: {
    greeting1: "今日のスタイリング、",
    greeting2: "ありがとうございました！",
    messageIcon: "💌",
    ctaButtonEmoji: "💝",
    ctaButtonText: "応援する",
    ctaSubtext: "登録不要 • PayPayでかんたん決済",
  },

  tipSelection: {
    title1: "感謝の気持ちを",
    title2: "選んでください",
    customAmountLabel: "オンリーサンキュー（自由金額）",
    messageSectionTitle: "✉️ 本日の一言メッセージ。（任意）",
    messagePlaceholder: "今日もありがとうございました！素敵な仕上がりで嬉しいです✨",
    nameSectionTitle: "📝 お名前（ニックネームでもOK・任意）",
    namePlaceholder: "例：たろう",
    totalLabel: "応援金額",
    payButtonText: "PayPayで応援する",
    minAmountNote: "※ 最低金額は100円です",
  },

  thanksPage: {
    heartEmoji: "💖",
    title1: "ありがとう",
    title2: "ございます！",
    amountSuffix: "の応援を届けました",
    fromSuffix: "より",
    shareText: "この体験をシェアしませんか？",
    returnButtonText: "トップに戻る",
  },

  tipOptions: [
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
  ],
};
