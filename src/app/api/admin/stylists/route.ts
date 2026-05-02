import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET: 全スタイリストを取得
export async function GET() {
  try {
    const { data, error } = await supabase
      .from("stylists")
      .select("*")
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("Supabase error:", error);
      // Supabaseに接続できない場合はmock-dataにフォールバック
      const { STYLISTS, TEAM_STYLIST } = await import("@/lib/mock-data");
      return NextResponse.json([TEAM_STYLIST, ...STYLISTS]);
    }

    return NextResponse.json(data);
  } catch {
    // フォールバック
    const { STYLISTS, TEAM_STYLIST } = await import("@/lib/mock-data");
    return NextResponse.json([TEAM_STYLIST, ...STYLISTS]);
  }
}

// POST: スタイリストを追加/更新
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, name, slug, avatar_url, message, thank_you_message, is_active, sort_order } = body;

    if (id) {
      // 更新
      const { data, error } = await supabase
        .from("stylists")
        .upsert({
          id,
          salon_id: "salon-001",
          name,
          slug,
          avatar_url: avatar_url || "/logo.png",
          message: message || "",
          thank_you_message: thank_you_message || "",
          is_active: is_active !== undefined ? is_active : true,
          sort_order: sort_order || 0,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json(data);
    } else {
      // 新規追加
      const newId = `stylist-${Date.now()}`;
      const { data, error } = await supabase
        .from("stylists")
        .insert({
          id: newId,
          salon_id: "salon-001",
          name,
          slug,
          avatar_url: avatar_url || "/logo.png",
          message: message || "",
          thank_you_message: thank_you_message || "",
          is_active: is_active !== undefined ? is_active : true,
          sort_order: sort_order || 99,
        })
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json(data);
    }
  } catch (error) {
    console.error("Error saving stylist:", error);
    return NextResponse.json({ error: "Failed to save stylist" }, { status: 500 });
  }
}

// DELETE: スタイリストを削除
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("stylists")
      .delete()
      .eq("id", id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting stylist:", error);
    return NextResponse.json({ error: "Failed to delete stylist" }, { status: 500 });
  }
}
