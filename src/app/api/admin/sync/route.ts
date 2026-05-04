import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET: mock-dataの内容でSupabase DBのスタイリストを一括更新
export async function GET() {
  const stylists = [
    { id: "team", name: "CARTA全体", slug: "team", avatar_url: "/logo.png",
      message: "CARTAスタッフ一同、心を込めてお客様をお迎えしています。みなさまの応援がチーム全体の力になります 🙌",
      thank_you_message: "CARTAスタッフ一同より、温かい応援ありがとうございます！これからもチーム一丸となって素敵なサロンを作っていきます💖",
      sort_order: 0 },
    { id: "stylist-001", name: "まりあ", slug: "maria", avatar_url: "/stylists/maria.jpg",
      message: "いつもご来店ありがとうございます！みなさまからの応援が、もっと良い技術を磨くモチベーションになります ✨",
      thank_you_message: "温かい応援、本当にありがとうございます！もっともっと素敵なスタイルを提案できるように頑張ります💕",
      sort_order: 1 },
    { id: "stylist-002", name: "のの", slug: "nono", avatar_url: "/stylists/nono.jpg",
      message: "お客様の笑顔が一番の喜びです！いただいた応援は、技術向上のための研修費に充てさせていただきます 🌸",
      thank_you_message: "ありがとうございます！次回もさらに素敵にしますね！🌟",
      sort_order: 2 },
    { id: "stylist-003", name: "ちさと", slug: "chisato", avatar_url: "/stylists/chisato.jpg",
      message: "カラーリングが得意です！応援いただいたお気持ちは、新しいカラー剤の研究に使わせていただきます 🎨",
      thank_you_message: "嬉しいです！またお会いできるのを楽しみにしています✨",
      sort_order: 3 },
    { id: "stylist-004", name: "かずね", slug: "kazune", avatar_url: "/stylists/kazune.jpg",
      message: "ハサミの研ぎ代として、応援いただけると嬉しいです！最高の切れ味でカットします ✂️",
      thank_you_message: "応援ありがとうございます！次のカットも楽しみにしていてくださいね💪",
      sort_order: 4 },
    { id: "stylist-005", name: "あかり", slug: "akari", avatar_url: "/stylists/akari.jpg",
      message: "ヘッドスパが得意です！いただいた応援で、もっと気持ちいい施術ができるよう頑張ります 💆‍♀️",
      thank_you_message: "心からありがとうございます！癒しの時間をもっとお届けしますね🍀",
      sort_order: 5 },
    { id: "stylist-006", name: "たくま", slug: "takuma", avatar_url: "/stylists/takuma.jpg",
      message: "メンズカットならお任せください！応援がさらなる技術向上の糧になります 💈",
      thank_you_message: "ありがとうございます！かっこよく仕上げますよ！🔥",
      sort_order: 6 },
    { id: "stylist-007", name: "てり", slug: "teri", avatar_url: "/stylists/teri.jpg",
      message: "トレンドスタイルが好きです！応援で最新の技術セミナーに参加させていただきます 📚",
      thank_you_message: "温かいお気持ち感謝です！最新のスタイルお見せしますね✨",
      sort_order: 7 },
    { id: "stylist-008", name: "むーちょ", slug: "mucho", avatar_url: "/stylists/mucho.jpg",
      message: "パーマスタイルならお任せ！いただいた応援で新しい技術を磨きます 🌀",
      thank_you_message: "応援ありがとうございます！もっと素敵に仕上げますね💫",
      sort_order: 8 },
    { id: "stylist-009", name: "さがべー", slug: "sagabe", avatar_url: "/stylists/sagabe.jpg",
      message: "お客様の理想を形にするのが大好きです！応援お待ちしています 🙌",
      thank_you_message: "ありがとうございます！これからも頑張ります！😊",
      sort_order: 9 },
    { id: "stylist-010", name: "こゆき", slug: "koyuki", avatar_url: "/stylists/koyuki.jpg",
      message: "繊細なカットが得意です！応援でもっと良いハサミを手に入れたいです ✨",
      thank_you_message: "本当にありがとうございます！精一杯頑張ります🌸",
      sort_order: 10 },
    { id: "stylist-011", name: "あみ", slug: "ami", avatar_url: "/stylists/ami.jpg",
      message: "お客様に寄り添ったスタイル提案を心がけています！応援よろしくお願いします 🌟",
      thank_you_message: "温かい応援ありがとうございます！もっと頑張ります💖",
      sort_order: 11 },
  ];

  const results = [];

  // 既存データを全削除
  await supabase.from("stylists").delete().neq("id", "___dummy___");

  // 正しいデータを挿入
  for (const s of stylists) {
    const { data, error } = await supabase.from("stylists").upsert({
      id: s.id,
      salon_id: "salon-001",
      name: s.name,
      slug: s.slug,
      avatar_url: s.avatar_url,
      message: s.message,
      thank_you_message: s.thank_you_message,
      is_active: true,
      sort_order: s.sort_order,
      updated_at: new Date().toISOString(),
    }).select().single();

    results.push({ id: s.id, name: s.name, success: !error, error: error?.message });
  }

  return NextResponse.json({ message: "DB sync complete", results });
}
