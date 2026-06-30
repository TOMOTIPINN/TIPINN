import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireManager } from "@/lib/manager-guard";
import {
  SALON_ASSETS_BUCKET,
  validateImage,
  uploadPublicImage,
} from "@/lib/storage";

/**
 * POST /api/manager/profile — サロンロゴのアップロード＋位置/ズーム保存（A6 店舗プロフィール / [[auth-method-line-b]]）
 *   入力: logo（任意・form-data の File）＋ logo_pos_x/y・logo_zoom（位置%・ズーム倍率）。
 *         salon_id はセッション由来（クライアントから受けない・越境不可）。
 *   保存: 新ファイルがあれば salon-assets/salons/<salon_id>/logo に upsert → public URL を logo_url に。
 *         ファイル無しでも位置/ズームだけの更新を許可（既存 logo_url は維持）。
 *
 * 認可: requireManager（未ログイン401 / 非manager403）。書き込みは service_role・サーバー側のみ（§3・§8）。
 * 検証: 画像は MIME（png/jpeg/webp）＋サイズ（2MB）／ 位置・ズームは数値化＋クランプ（DBのCHECKと同値域）。
 * 応答: フォーム送信 → /manager/profile?saved=1（成功）/ ?error=<reason>（失敗）へ303。
 */
export const runtime = "nodejs";

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
  const back = (qs: string) =>
    NextResponse.redirect(new URL(`/manager/profile?${qs}`, baseUrl), {
      status: 303,
    });

  const form = await req.formData().catch(() => null);
  if (!form) return back("error=upload");

  // 位置・ズームはサーバー側でも必ずクランプ（クライアントを信用しない・越境値遮断）。
  const update: {
    logo_url?: string;
    logo_pos_x: number;
    logo_pos_y: number;
    logo_zoom: number;
  } = {
    logo_pos_x: clampNumber(form.get("logo_pos_x"), -50, 50, 0),
    logo_pos_y: clampNumber(form.get("logo_pos_y"), -50, 50, 0),
    logo_zoom: clampNumber(form.get("logo_zoom"), 1, 3, 1),
  };

  // ファイルは任意。選択されているときだけ検証＋アップロードして logo_url を差し替える。
  const fileValue = form.get("logo");
  const hasFile = fileValue instanceof File && fileValue.size > 0;
  if (hasFile) {
    const check = validateImage(fileValue);
    if (!check.ok) return back(`error=${check.error}`);

    // 同一パス固定（拡張子なし）。upsert で常に上書きされ孤児ファイルが残らない。
    const path = `salons/${ctx.salon_id}/logo`;
    const uploaded = await uploadPublicImage({
      bucket: SALON_ASSETS_BUCKET,
      path,
      file: check.file,
      contentType: check.contentType,
    });
    if (!uploaded.ok) return back("error=upload");

    // public URL は不変のため、CDN/ブラウザのキャッシュ回避に版数を付けて保存する。
    update.logo_url = `${uploaded.publicUrl}?v=${Date.now()}`;
  }

  const { error } = await supabaseAdmin
    .from("salons")
    .update(update)
    .eq("id", ctx.salon_id);

  if (error) {
    console.error("salon logo update failed:", error);
    return back("error=save");
  }

  return back("saved=1");
}
