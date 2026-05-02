import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET: チップ（応援）履歴を取得
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const stylistId = searchParams.get("stylist_id");
    const limit = parseInt(searchParams.get("limit") || "100");

    let query = supabase
      .from("tips")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (stylistId && stylistId !== "all") {
      query = query.eq("stylist_id", stylistId);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Supabase error:", error);
      return NextResponse.json([]);
    }

    return NextResponse.json(data || []);
  } catch {
    return NextResponse.json([]);
  }
}

// POST: 新しいチップ（応援）を記録
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { stylist_id, stylist_name, amount, message, sender_name } = body;

    const { data, error } = await supabase
      .from("tips")
      .insert({
        id: `tip-${Date.now()}`,
        stylist_id,
        stylist_name,
        amount,
        message: message || "",
        sender_name: sender_name || "",
        status: "completed",
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error recording tip:", error);
    return NextResponse.json({ error: "Failed to record tip" }, { status: 500 });
  }
}
