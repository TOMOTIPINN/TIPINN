import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";

/**
 * GET /api/staff?salonId=<uuid>
 * 指定サロンのスタッフ一覧を返す（感想フォームのプルダウン用）。
 * RLS は deny-by-default のためクライアント直叩き不可。ログイン済みの顧客に対し
 * service role で取得し、必ず salon_id でスコープする（原則4: マルチテナント起点）。
 * 個人情報は返さない（id / name / photo_url のみ）。
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.customer_id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const salonId = new URL(req.url).searchParams.get("salonId");
  if (!salonId) {
    return NextResponse.json({ error: "missing_salon_id" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("staff")
    .select("id, name, photo_url")
    .eq("salon_id", salonId)
    .order("name", { ascending: true });

  if (error) {
    console.error("staff fetch failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  return NextResponse.json({ staff: data ?? [] });
}
