import { createHash, timingSafeEqual } from "node:crypto";
import type { SessionPayload } from "@/lib/session";

/**
 * 営業デモ用ログインバイパスの「単一ソース」（本番Prodでは無効・Previewでのみ有効）。
 *
 * ★安全設計の核★
 *  - このバイパスは **リクエストから ID を一切受け取らない**。呼び出し側が選べるのは
 *    `as = customer | staff` の enum だけで、実際の customer_id / line_user_id は
 *    ここ（サーバー定数）に固定。よって実在の顧客/スタッフを狙う入力経路が存在しない。
 *  - 発行対象は下記2 persona のみ。いずれも固定UUIDのデモサロン(DEMO_SALON_ID)に紐づく。
 *  - UUID はデモseed SQL と **同じ値**を使う（この定数が唯一の正）。
 *
 * 有効化は二重ゲート（isDemoLoginEnabled）: DEMO_LOGIN_ENABLED==="true" かつ
 * DEMO_LOGIN_SECRET が設定済みのときだけ。本番Prod env には置かない＝常に無効(404)。
 */

// デモseed と共有する固定UUID（実データと衝突しない専用値）。
export const DEMO_SALON_ID = "deded000-0000-0000-0000-000000000000";

export type DemoPersonaKey = "customer" | "staff";

type DemoPersona = SessionPayload & {
  /** 発行後の着地先。 */
  redirectTo: string;
};

/**
 * 発行できる persona は以下の2件のみ（サーバー定数・リクエストからは選べない）。
 *  - customer: staff 行に無い line_user_id ＝ getStaffContext が null → 純・顧客視点。
 *  - staff   : デモサロンの店長 staff 行の line_user_id と一致 → 店長/スタッフ視点。
 * line_user_id は "demo:" 接頭辞で実 LINE の sub と決して衝突させない。
 */
export const DEMO_PERSONAS: Record<DemoPersonaKey, DemoPersona> = {
  customer: {
    customer_id: "deded001-0000-0000-0000-000000000000",
    line_user_id: "demo:customer:echo",
    redirectTo: "/mypage",
  },
  staff: {
    customer_id: "deded002-0000-0000-0000-000000000000",
    line_user_id: "demo:manager:echo",
    redirectTo: "/staff",
  },
};

/** デモ persona の line_user_id は必ずこの接頭辞（実ユーザー保護の照合に使う）。 */
export const DEMO_LINE_PREFIX = "demo:";

/**
 * 二重ゲート。DEMO_LOGIN_ENABLED==="true" かつ DEMO_LOGIN_SECRET 設定済みのときだけ true。
 * 本番Prod env にこれらを置かなければ常に false ＝ /demo も /api/demo/login も 404。
 */
export function isDemoLoginEnabled(): boolean {
  return (
    process.env.DEMO_LOGIN_ENABLED === "true" &&
    typeof process.env.DEMO_LOGIN_SECRET === "string" &&
    process.env.DEMO_LOGIN_SECRET.length > 0
  );
}

/**
 * シークレット照合（定数時間）。両者を SHA-256 に通してから timingSafeEqual で比較し、
 * 長さの差もリークさせない。secret 未設定や不一致は false。
 */
export function verifyDemoKey(provided: unknown): boolean {
  const secret = process.env.DEMO_LOGIN_SECRET;
  if (!secret || typeof provided !== "string" || provided.length === 0) {
    return false;
  }
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}
