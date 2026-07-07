import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireManager } from "@/lib/manager-guard";
import {
  SALON_ASSETS_BUCKET,
  validateImage,
  uploadPublicImage,
} from "@/lib/storage";

/**
 * POST /api/manager/staff/update — スタッフのプロフィール更新（A2 スタッフ編集 / [[auth-method-line-b]]）
 *   入力: staffId ＋ job_title（職種）＋ bio（一言）＋ photo（任意・File）＋ photo_pos_x/y・photo_zoom。
 *   更新: job_title / bio / 写真位置・ズームは常に上書き。写真ファイルは選択時のみ
 *         salon-assets/staff/<staff_id>/photo に upsert → public URL を photo_url に。
 *         salon_id はセッション由来でスコープ（越境不可）。
 *
 * 認可: requireManager（未ログイン401 / 非manager403）＋ staffId が ctx.salon_id 所属か照合。
 * 検証: 画像は MIME（png/jpeg/webp）＋サイズ（2MB）／ job_title・bio は長さをアプリ層で検証／
 *       位置・ズームは数値化＋クランプ（DBのCHECKと同値域 -50..50 / 1..3）。
 *       ※ job_title は職種であり、権限列 role とは別物（role はここでは一切触らない）。
 * 応答: フォーム送信 → /manager/staff/<id>?saved=1（成功）/ ?error=<reason>（失敗）へ303。
 */
export const runtime = "nodejs";

const NAME_MAX = 50;
const JOB_TITLE_MAX = 30;
const BIO_MAX = 100;

/** form 値を数値化し min..max にクランプ（不正値は fallback）。DBの CHECK と同じ値域を使う。 */
function clampNumber(
  value: FormDataEntryValue | null | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export async function POST(req: Request) {
  const gate = await requireManager();
  if (!gate.ok) return gate.res;
  const { ctx } = gate;

  const baseUrl = process.env.APP_BASE_URL!;
  const form = await req.formData().catch(() => null);
  const staffId =
    typeof form?.get("staffId") === "string"
      ? (form!.get("staffId") as string)
      : "";

  // staffId 不明なら一覧へ戻す（個別ページに戻れないため）。
  if (!form || !staffId) {
    return NextResponse.redirect(new URL(`/manager/staff?error=update`, baseUrl), {
      status: 303,
    });
  }

  const back = (qs: string) =>
    NextResponse.redirect(
      new URL(`/manager/staff/${staffId}?${qs}`, baseUrl),
      { status: 303 },
    );

  // 越境防止: 対象スタッフが自分のサロン所属か確認してから更新する。
  const { data: target } = await supabaseAdmin
    .from("staff")
    .select("id, salon_id")
    .eq("id", staffId)
    .maybeSingle();
  if (!target || target.salon_id !== ctx.salon_id) {
    return NextResponse.redirect(new URL(`/manager/staff?error=update`, baseUrl), {
      status: 303,
    });
  }

  // 名前は必須（staff.name は NOT NULL）。空・超過は 400（作成APIと同じ扱い）。role は非タッチ。
  const nameRaw = form.get("name");
  const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
  if (!name || name.length > NAME_MAX) {
    return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  }

  const jobTitleRaw = form.get("job_title");
  const bioRaw = form.get("bio");
  const jobTitle =
    typeof jobTitleRaw === "string" ? jobTitleRaw.trim() : "";
  const bio = typeof bioRaw === "string" ? bioRaw.trim() : "";
  if (jobTitle.length > JOB_TITLE_MAX || bio.length > BIO_MAX) {
    return back("error=length");
  }

  // 空文字は null として保存（未設定扱い）。位置・ズームはサーバー側でも必ずクランプ。
  const update: {
    name: string;
    job_title: string | null;
    bio: string | null;
    photo_pos_x: number;
    photo_pos_y: number;
    photo_zoom: number;
    photo_url?: string;
  } = {
    name,
    job_title: jobTitle || null,
    bio: bio || null,
    photo_pos_x: clampNumber(form.get("photo_pos_x"), -50, 50, 0),
    photo_pos_y: clampNumber(form.get("photo_pos_y"), -50, 50, 0),
    photo_zoom: clampNumber(form.get("photo_zoom"), 1, 3, 1),
  };

  // 写真は任意。選択されているときだけ検証＋アップロードして photo_url を差し替える。
  const fileValue = form.get("photo");
  const hasFile = fileValue instanceof File && fileValue.size > 0;
  if (hasFile) {
    const check = validateImage(fileValue);
    if (!check.ok) return back(`error=${check.error}`);

    const path = `staff/${staffId}/photo`;
    const uploaded = await uploadPublicImage({
      bucket: SALON_ASSETS_BUCKET,
      path,
      file: check.file,
      contentType: check.contentType,
    });
    if (!uploaded.ok) return back("error=upload");

    // public URL は不変のため、CDN/ブラウザのキャッシュ回避に版数を付ける。
    update.photo_url = `${uploaded.publicUrl}?v=${Date.now()}`;
  }

  const { error } = await supabaseAdmin
    .from("staff")
    .update(update)
    .eq("id", staffId)
    .eq("salon_id", ctx.salon_id); // 二重スコープ（保険）

  if (error) {
    console.error("staff profile update failed:", error);
    return back("error=save");
  }

  return back("saved=1");
}
