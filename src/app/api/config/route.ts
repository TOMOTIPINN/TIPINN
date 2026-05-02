import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET: サイト設定を取得
export async function GET() {
  try {
    const { data, error } = await supabase
      .from("site_config")
      .select("config")
      .eq("id", "main")
      .single();

    if (error || !data) {
      // フォールバック: デフォルト設定
      const { DEFAULT_SITE_CONFIG } = await import("@/lib/site-config");
      return NextResponse.json(DEFAULT_SITE_CONFIG);
    }

    return NextResponse.json(data.config);
  } catch {
    const { DEFAULT_SITE_CONFIG } = await import("@/lib/site-config");
    return NextResponse.json(DEFAULT_SITE_CONFIG);
  }
}

// POST: サイト設定を更新
export async function POST(request: Request) {
  try {
    const config = await request.json();

    const { error } = await supabase
      .from("site_config")
      .upsert({
        id: "main",
        config,
        updated_at: new Date().toISOString(),
      });

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving config:", error);
    return NextResponse.json({ error: "Failed to save config" }, { status: 500 });
  }
}
