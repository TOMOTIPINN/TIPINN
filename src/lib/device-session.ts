import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * 受付端末（キオスク）セッション = { salon_id, device_token } を含む署名付きJWTを httpOnly Cookie に保存する。
 * LINEログイン無しで /staff/visit を使えるようにするための「店の端末」認証（[[auth-method-line-b]] の追加経路）。
 *
 * 設計:
 * - 署名は既存 SESSION_SECRET を流用（改ざん防止）。ただし権威は常に DB 側にある。
 * - getDeviceContext() は cookie を復号したあと **必ず DB で device_token を再照合** する。
 *   → manager が再発行（salons.device_token を UPDATE で上書き）すると、旧 cookie は一致しなくなり
 *     全キオスクが即座に失効する（漏洩時対応の要）。
 * - 端末は salon_id に紐付き、その端末の記録は必ずその店（越境不可）。
 *
 * 検証はサーバー（Route Handler / Server Component）でのみ行う。DBアクセスは service_role のみ（§3）。
 */
export const DEVICE_COOKIE_NAME = "echo_device";
export const DEVICE_MAX_AGE = 60 * 60 * 24 * 365; // 1年（常設端末・秒）

const secret = new TextEncoder().encode(process.env.SESSION_SECRET!);

export type DevicePayload = {
  salon_id: string;
  device_token: string;
};

export async function createDeviceToken(payload: DevicePayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${DEVICE_MAX_AGE}s`)
    .sign(secret);
}

async function verifyDeviceToken(token: string): Promise<DevicePayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    const salon_id = payload.salon_id;
    const device_token = payload.device_token;
    if (typeof salon_id !== "string" || typeof device_token !== "string") {
      return null;
    }
    return { salon_id, device_token };
  } catch {
    return null;
  }
}

/**
 * cookie の JWT を **署名検証だけ** して payload（salon_id, device_token）を返す（未ログインなら null）。
 * DB 再照合はしない。用途は per-salon manifest の href 組み立て（/kiosk/layout の generateMetadata）に限る
 * — manifest route 側で DB 突合するので、ここは「どのURLを配るか」を決めるためのローカル読み出しでよい。
 * 認可判定（実際に受付を通すか）は必ず getDeviceContext()（DB再照合あり）を使うこと。
 */
export async function getDeviceCookie(): Promise<DevicePayload | null> {
  const store = await cookies();
  const token = store.get(DEVICE_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyDeviceToken(token);
}

/**
 * 現在のリクエストの端末コンテキストを解決する（未登録/失効なら null）。
 * cookie の JWT を検証したうえで、salons.device_token と一致するかを DB で必ず再確認する。
 * 一致しない（= 再発行済み or 削除済み or 端末未発行）場合は null＝失効扱い。
 */
export async function getDeviceContext(): Promise<{ salon_id: string } | null> {
  const store = await cookies();
  const token = store.get(DEVICE_COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = await verifyDeviceToken(token);
  if (!payload) return null;

  // 権威は DB。再発行されていれば device_token が一致せず失効する。
  const { data: salon } = await supabaseAdmin
    .from("salons")
    .select("id, device_token")
    .eq("id", payload.salon_id)
    .maybeSingle<{ id: string; device_token: string | null }>();

  if (!salon || !salon.device_token || salon.device_token !== payload.device_token) {
    return null;
  }

  return { salon_id: salon.id };
}
