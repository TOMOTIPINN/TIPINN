import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import {
  validateReviewBody,
  isValidRating,
  isValidShareScope,
  normalizeTags,
  normalizeReviewSource,
} from "@/lib/review";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.customer_id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: {
    salonId?: string;
    staffId?: string;
    toSalon?: boolean;
    body?: string;
    rating?: unknown;
    tags?: unknown;
    shareScope?: unknown;
    source?: unknown;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { salonId, staffId, toSalon, body, rating, tags, shareScope, source } =
    payload;
  if (!salonId || typeof body !== "string") {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // 本文の文字数ルールはクライアントと共有（min 15 / max 300・trim後）
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

  // 宛先の解決。toSalon===true は「お店のみんなへ」＝staff_id null（明示フラグで未選択と区別）。
  // それ以外は staffId 必須。空文字/undefined を null と取り違えない（未選択は 400）。
  let resolvedStaffId: string | null;
  if (toSalon === true) {
    resolvedStaffId = null;
  } else {
    if (!staffId || typeof staffId !== "string") {
      return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    }
    // 退職者（archived_at 有り）／他サロン／不存在の staff には新規感想を受け付けない。
    // 過去の reviews は残す（論理削除のため staff_id は保持される）。
    const { data: staff } = await supabaseAdmin
      .from("staff")
      .select("id")
      .eq("id", staffId)
      .eq("salon_id", salonId)
      .is("archived_at", null)
      .maybeSingle();
    if (!staff) {
      return NextResponse.json({ error: "invalid_staff" }, { status: 400 });
    }
    resolvedStaffId = staffId;
  }

  const { data, error } = await supabaseAdmin.rpc(
    "submit_review_and_earn_stamp",
    {
      p_customer_id: session.customer_id,
      p_salon_id: salonId,
      p_staff_id: resolvedStaffId,
      p_body: body.trim(),
      p_rating: rating,
      p_tags: normalizedTags,
      p_share_scope: shareScope,
    }
  );

  if (error) {
    console.error("submit_review_and_earn_stamp failed:", error);
    // 来店裏付けチェック（0032）で弾かれたケースだけ専用コードで返す。
    // RPC は `raise exception 'no_visit_today'` で弾く＝ error.message が完全一致する
    // （他の raise は 'invalid rating: %' 等の書式付きでこの語を含まない）。
    // 業務上の失敗＝ 409（/api/staff/visit の no_visit_today と同じ扱い）。それ以外は従来の 500。
    if (error.message === "no_visit_today") {
      return NextResponse.json({ error: "no_visit_today" }, { status: 409 });
    }
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  const r = Array.isArray(data) ? data[0] : data;

  // 本日分の感想が既に存在＝2通目以降。エラーではなく既送信を優しく返す（客を責めない・要件2）。
  // 判定は RPC 側（advisory lock 内・0020）で行い、ここは 200 でフラグを返すだけ。
  if (r.already_submitted) {
    return NextResponse.json({ alreadySubmitted: true });
  }

  // 流入元（reviews.source・0052）。RPC には渡さず、作成直後の行にだけ別に書く（案B）。
  //   RPC の signature を変えると drop→create が要り、過去に並存（40_decisions §1.2）と
  //   処理の脱落（§1.1）を起こしているため、関数には手を入れない。
  //   集計専用の値なので、ここが失敗しても感想の送信は成功のまま返す（null で残るだけ）。
  //   .is("source", null) … 既に値がある行を上書きしない。
  const normalizedSource = normalizeReviewSource(source);
  if (normalizedSource && r.review_id) {
    const { error: sourceError } = await supabaseAdmin
      .from("reviews")
      .update({ source: normalizedSource })
      .eq("id", r.review_id)
      .is("source", null);
    if (sourceError) {
      console.error("[reviews] source の記録に失敗", {
        reviewId: r.review_id,
        source: normalizedSource,
        code: sourceError.code,
      });
    }
  }

  return NextResponse.json({
    reviewId: r.review_id,
    earnedCount: r.new_count,
    stampAwarded: r.stamp_awarded,
  });
}
