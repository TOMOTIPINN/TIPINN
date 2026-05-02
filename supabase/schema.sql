-- tipinn データベーススキーマ
-- Supabase SQL Editor で実行してください

-- ==========================================
-- 1. スタイリストテーブル
-- ==========================================
CREATE TABLE IF NOT EXISTS stylists (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  salon_id TEXT NOT NULL DEFAULT 'salon-001',
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  avatar_url TEXT NOT NULL DEFAULT '/logo.png',
  message TEXT NOT NULL DEFAULT '',
  thank_you_message TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==========================================
-- 2. チップ（応援）テーブル
-- ==========================================
CREATE TABLE IF NOT EXISTS tips (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  stylist_id TEXT NOT NULL,
  stylist_name TEXT NOT NULL,
  amount INTEGER NOT NULL,
  message TEXT DEFAULT '',
  sender_name TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==========================================
-- 3. サイト設定テーブル
-- ==========================================
CREATE TABLE IF NOT EXISTS site_config (
  id TEXT PRIMARY KEY DEFAULT 'main',
  config JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==========================================
-- 4. RLS (Row Level Security) ポリシー
-- ==========================================
-- 読み取りは全員OK、書き込みは認証済みユーザーのみ（MVPでは全員許可）

ALTER TABLE stylists ENABLE ROW LEVEL SECURITY;
ALTER TABLE tips ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_config ENABLE ROW LEVEL SECURITY;

-- stylists: 誰でも読み取り可能
CREATE POLICY "stylists_read" ON stylists
  FOR SELECT USING (true);

-- stylists: 誰でも書き込み可能（MVP用、本番ではauth制限追加）
CREATE POLICY "stylists_write" ON stylists
  FOR ALL USING (true) WITH CHECK (true);

-- tips: 誰でも読み取り可能
CREATE POLICY "tips_read" ON tips
  FOR SELECT USING (true);

-- tips: 誰でも書き込み可能
CREATE POLICY "tips_write" ON tips
  FOR ALL USING (true) WITH CHECK (true);

-- site_config: 誰でも読み取り可能
CREATE POLICY "site_config_read" ON site_config
  FOR SELECT USING (true);

-- site_config: 誰でも書き込み可能
CREATE POLICY "site_config_write" ON site_config
  FOR ALL USING (true) WITH CHECK (true);

-- ==========================================
-- 5. 初期データ: スタイリスト
-- ==========================================
INSERT INTO stylists (id, salon_id, name, slug, avatar_url, message, thank_you_message, is_active, sort_order) VALUES
  ('team', 'salon-001', 'CARTA全体', 'team', '/logo.png',
   'CARTAスタッフ一同、心を込めてお客様をお迎えしています。みなさまの応援がチーム全体の力になります 🙌',
   'CARTAスタッフ一同より、温かい応援ありがとうございます！これからもチーム一丸となって素敵なサロンを作っていきます💖',
   true, 0),
  ('stylist-001', 'salon-001', 'まりあ', 'maria', '/stylists/maria.jpg',
   'いつもご来店ありがとうございます！みなさまからの応援が、もっと良い技術を磨くモチベーションになります ✨',
   '温かい応援、本当にありがとうございます！もっともっと素敵なスタイルを提案できるように頑張ります💕',
   true, 1),
  ('stylist-002', 'salon-001', 'のの', 'nono', '/stylists/nono.jpg',
   'お客様一人一人に似合うスタイルを追求しています！応援よろしくお願いします 🌸',
   'ありがとうございます！いただいた応援を糧に、もっと素敵なスタイルを作れるように精進します🌟',
   true, 2),
  ('stylist-003', 'salon-001', 'たくま', 'takuma', '/stylists/takuma.jpg',
   'カット技術を日々磨いています！応援でもっと良いハサミを手に入れたいです 💪',
   '応援ありがとうございます！いただいた気持ちを大切に、さらに技術を磨いていきます✨',
   true, 3),
  ('stylist-004', 'salon-001', 'あかり', 'akari', '/stylists/akari.jpg',
   'カラーリングが得意です！お客様の理想を叶えるために頑張ります 🎨',
   '応援ありがとうございます！もっとたくさんの素敵なカラーを提案できるように頑張ります💕',
   true, 4),
  ('stylist-005', 'salon-001', 'あゆむ', 'ayumu', '/stylists/ayumu.jpg',
   'トレンドスタイルを取り入れたカットが得意です！応援お待ちしています 🔥',
   'たくさんの応援ありがとうございます！最高のスタイルをお届けできるよう精進します🌟',
   true, 5),
  ('stylist-006', 'salon-001', 'さがべー', 'sagabe', '/stylists/sagabe.jpg',
   'お客様の笑顔が一番のモチベーション！応援よろしくお願いします 😊',
   '応援ありがとうございます！お客様に最高の笑顔をお届けできるよう頑張ります✨',
   true, 6),
  ('stylist-007', 'salon-001', 'まなみ', 'manami', '/stylists/manami.jpg',
   'ヘアアレンジとカラーが大好きです！みなさまの応援が力になります 💖',
   '素敵な応援をありがとうございます！もっともっとスキルアップして恩返ししますね💕',
   true, 7),
  ('stylist-008', 'salon-001', 'こゆき', 'koyuki', '/stylists/koyuki.jpg',
   '繊細なカットが得意です！応援でもっと良いハサミを手に入れたいです ✨',
   '応援ありがとうございます！これからもお客様に寄り添ったスタイルをお届けします🌸',
   true, 8),
  ('stylist-009', 'salon-001', 'あみ', 'ami', '/stylists/ami.jpg',
   'お客様に寄り添ったスタイル提案を心がけています！応援よろしくお願いします 🌟',
   'ありがとうございます！いただいた応援でさらに成長していきます✨',
   true, 9),
  ('stylist-010', 'salon-001', 'てり', 'teri', '/stylists/teri.jpg',
   '海外トレンドを取り入れたスタイルが得意です！みなさまの応援が嬉しいです 🌍',
   'Thank you for your support! これからも最高のスタイルをお届けします💫',
   true, 10),
  ('stylist-011', 'salon-001', 'むーちょ', 'mucho', '/stylists/mucho.jpg',
   'パーマスタイルが得意です！応援よろしくお願いします 🙏',
   '温かい応援ありがとうございます！もっと素敵なパーマスタイルを作れるよう頑張ります🙌',
   true, 11)
ON CONFLICT (id) DO NOTHING;

-- ==========================================
-- 6. 初期データ: サイト設定
-- ==========================================
INSERT INTO site_config (id, config) VALUES (
  'main',
  '{
    "home": {
      "heroEmoji": "💝",
      "heroTitle1": "今日の感謝を",
      "heroTitle2": "カタチにしよう",
      "heroSubtitle1": "担当スタイリストに、",
      "heroSubtitle2": "ありがとうの気持ちを届けませんか？",
      "sectionTitle": "今日担当したスタッフ",
      "sectionIcon": "✨",
      "teamName": "箱推し！",
      "teamDesc": "CARTA全体を応援",
      "ctaButtonText": "応援する",
      "ctaNote": "登録不要・アプリダウンロード不要"
    },
    "stylistLanding": {
      "greeting1": "今日のスタイリング、",
      "greeting2": "ありがとうございました！",
      "messageIcon": "💌",
      "ctaButtonEmoji": "💝",
      "ctaButtonText": "応援する",
      "ctaSubtext": "登録不要 • PayPayでかんたん決済"
    },
    "tipSelection": {
      "title1": "感謝の気持ちを",
      "title2": "選んでください",
      "customAmountLabel": "オンリーサンキュー（自由金額）",
      "messageSectionTitle": "✉️ 本日の一言メッセージ。（任意）",
      "messagePlaceholder": "今日もありがとうございました！素敵な仕上がりで嬉しいです✨",
      "nameSectionTitle": "📝 お名前（ニックネームでもOK・任意）",
      "namePlaceholder": "例：たろう",
      "totalLabel": "応援金額",
      "payButtonText": "PayPayで応援する",
      "minAmountNote": "※ 最低金額は100円です"
    },
    "thanksPage": {
      "heartEmoji": "💖",
      "title1": "ありがとう",
      "title2": "ございます！",
      "amountSuffix": "の応援を届けました",
      "fromSuffix": "より",
      "shareText": "この体験をシェアしませんか？",
      "returnButtonText": "トップに戻る"
    },
    "tipOptions": [
      {"amount": 200, "emoji": "🍦", "label": "ありがとうアイス", "description": "アイス1個分"},
      {"amount": 500, "emoji": "🍰", "label": "ありがとうケーキ", "description": "ケーキ1個分", "isPopular": true},
      {"amount": 1500, "emoji": "🍽️", "label": "ありがとうランチ", "description": "ランチ1回分"},
      {"amount": 3000, "emoji": "💐", "label": "ありがとう花束", "description": "花束1つ分"}
    ]
  }'
) ON CONFLICT (id) DO NOTHING;
