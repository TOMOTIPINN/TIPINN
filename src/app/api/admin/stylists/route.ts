import { NextRequest, NextResponse } from "next/server";
import { STYLISTS, type Stylist } from "@/lib/mock-data";

// GET: スタッフ一覧を返す
export async function GET() {
  return NextResponse.json({ stylists: STYLISTS });
}
