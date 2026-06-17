import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import {
  validateReviewBody,
  isValidRating,
  isValidShareScope,
  normalizeTags,
} from "@/lib/review";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.customer_id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: {
    salonId?: string;
    staffId?: string;
    body?: string;
    rating?: unknown;
    tags?: unknown;
    shareScope?: unknown;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { salonId, staffId, body, rating, tags, shareScope } = payload;
  if (!salonId || !staffId || typeof body !== "string") {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // 本文の文字数ルールはクライアントと共有（min 20 / max 300・trim後）
  const bodyError = validateReviewBody(body);
  if (bodyError) {
    return NextResponse.json({ error: bodyError }, { status: 400 });
  }

  // 評価・タグ・共有範囲（クライアントと同じ定数で検証）
  if (!isValidRating(rating)) {
    return NextResponse.json({ error: "invalid_rating" }, { status: 400 });
  }
  if (!isValidShareScope(shareScope)) {
    return NextResponse.json({ error: "invalid_share_scope" }, { status: 400 });
  }
  const normalizedTags = normalizeTags(tags);
  if (normalizedTags === null) {
    return NextResponse.json({ error: "invalid_tags" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc(
    "submit_review_and_earn_stamp",
    {
      p_customer_id: session.customer_id,
      p_salon_id: salonId,
      p_staff_id: staffId,
      p_body: body.trim(),
      p_rating: rating,
      p_tags: normalizedTags,
      p_share_scope: shareScope,
    }
  );

  if (error) {
    console.error("submit_review_and_earn_stamp failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  const r = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({
    reviewId: r.review_id,
    earnedCount: r.new_count,
    stampAwarded: r.stamp_awarded,
  });
}
