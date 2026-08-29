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

/**
 * 画像を1件削除する（サーバー側専用）。**例外は投げない**。
 *
 * 用途は「DB 側の削除に成功したあとの後片付け」。そこで throw / 500 を返すと
 * 「行は消えたのに失敗応答」という壊れた状態になるため、失敗は false を返して
 * 呼び出し側の応答を変えない（console.error に残して孤児を後から特定できるようにする）。
 * この方針は @/lib/line-messaging の pushText・@/lib/login-attempts と同じ
 * （副作用側の失敗で本処理を巻き添えにしない）。
 *
 * 上書き（差し替え）は uploadPublicImage の upsert で足りる＝ここを呼ぶ必要はない。
 * 呼ぶのは「そのパスをもう二度と使わない」ときだけ。
 */
export async function removePublicImage({
  bucket,
  path,
}: {
  bucket: string;
  path: string;
}): Promise<boolean> {
  const { error } = await supabaseAdmin.storage.from(bucket).remove([path]);

  if (error) {
    console.error(`storage remove failed: ${bucket}/${path}`, error);
    return false;
  }
  return true;
}
