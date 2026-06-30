import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * 画像アップロード共通基盤（サーバー専用 / CLAUDE.md §3・§8）。
 * Supabase Storage への書き込みは service_role の supabaseAdmin からのみ行う。
 * クライアント直叩きはしない（RLS deny-by-default と整合）。
 * 今回はサロンロゴ専用に使うが、将来 staff.photo_url など他の画像にも流用できる純関数群。
 */

/** 公開バケット名（Supabaseダッシュボードで手動作成済み・Public ON・2MB制限）。 */
export const SALON_ASSETS_BUCKET = "salon-assets";

/** 許可するMIME（png/jpeg/webp のみ）。拡張子は使わず content-type で判定する。 */
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

/** アップロード上限（2MB）。Supabaseバケット側にも同じ制限を設定済み（二重防御）。 */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export type ImageValidation =
  | { ok: true; file: File; contentType: string }
  | { ok: false; error: "missing" | "type" | "size" };

/** form-data の値が許可された画像Fileか検証する純関数（MIME / サイズ）。 */
export function validateImage(value: unknown): ImageValidation {
  if (!(value instanceof File) || value.size === 0) {
    return { ok: false, error: "missing" };
  }
  if (!ALLOWED_MIME.has(value.type)) {
    return { ok: false, error: "type" };
  }
  if (value.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: "size" };
  }
  return { ok: true, file: value, contentType: value.type };
}

/**
 * 画像をアップロードして public URL を返す（サーバー側専用）。
 * path は呼び出し側がスコープを決める（例 `salons/<salon_id>/logo`）。
 * upsert=true で同一パスを上書きするため、再アップロードしても増殖しない（孤児ファイルなし）。
 * public URL は不変なので、呼び出し側でキャッシュ回避の版数を付けて保存すること。
 */
export async function uploadPublicImage({
  bucket,
  path,
  file,
  contentType,
}: {
  bucket: string;
  path: string;
  file: File;
  contentType: string;
}): Promise<{ ok: true; publicUrl: string } | { ok: false }> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(path, buffer, { contentType, upsert: true });

  if (error) {
    console.error("storage upload failed:", error);
    return { ok: false };
  }

  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
  return { ok: true, publicUrl: data.publicUrl };
}
