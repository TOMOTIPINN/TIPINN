import { createHash, timingSafeEqual } from "node:crypto";
import type { SessionPayload } from "@/lib/session";

/**
 * 営業デモ用ログインバイパスの「単一ソース」（本番Prodでは無効・Previewでのみ有効）。
 *
 * ★安全設計の核★
 *  - このバイパスは **リクエストから ID を一切受け取らない**。呼び出し側が選べるのは
 *    `as = customer | staff` の enum だけで、実際の customer_id / line_user_id は
 *    ここ（サーバー定数）に固定。よって実在の顧客/スタッフを狙う入力経路が存在しない。
 *  - 発行対象は下記3 persona のみ。いずれも固定UUIDのデモサロン(DEMO_SALON_ID)に紐づく。
 *  - UUID はデモseed SQL と **同じ値**を使う（この定数が唯一の正）。
 *
 * 有効化は二重ゲート（isDemoLoginEnabled）: DEMO_LOGIN_ENABLED==="true" かつ
 * DEMO_LOGIN_SECRET が設定済みのときだけ。本番Prod env には置かない＝常に無効(404)。
 */

// デモseed と共有する固定UUID（実データと衝突しない専用値）。
export const DEMO_SALON_ID = "deded000-0000-0000-0000-000000000000";

export type DemoPersonaKey = "customer" | "staff" | "manager";

type DemoPersona = SessionPayload & {
  /** 発行後の着地先。 */
  redirectTo: string;
};

/**
 * 発行できる persona は以下の3件のみ（サーバー定数・リクエストからは選べない）。
 *  - customer: staff 行に無い line_user_id ＝ getStaffContext が null → 純・顧客視点。
 *  - staff   : デモサロンの一般スタッフ(role='staff', 佐藤) の line_user_id と一致 → スタッフ個人視点。
 *  - manager : デモサロンの店長(role='manager', 田中) の line_user_id と一致 → 店長視点（店長Inbox）。
 * line_user_id は "demo:" 接頭辞で実 LINE の sub と決して衝突させない。
 * staff/manager の customer_id はいずれも mypage を開いても壊れないための顧客保険行。
 */
export const DEMO_PERSONAS: Record<DemoPersonaKey, DemoPersona> = {
  customer: {
    customer_id: "deded001-0000-0000-0000-000000000000",
    line_user_id: "demo:customer:echo",
    redirectTo: "/mypage",
  },
  staff: {
    customer_id: "deded005-0000-0000-0000-000000000000",
    line_user_id: "demo:staff:echo",
    redirectTo: "/staff",
  },
  manager: {
    customer_id: "deded002-0000-0000-0000-000000000000",
    line_user_id: "demo:manager:echo",
    redirectTo: "/dashboard", // 数字管理トップに着地（SalonNav で店長系を回遊）
  },
};

/** デモ persona の line_user_id は必ずこの接頭辞（実ユーザー保護の照合に使う）。 */
export const DEMO_LINE_PREFIX = "demo:";

/**
 * 二重ゲート。DEMO_LOGIN_ENABLED==="true" かつ DEMO_LOGIN_SECRET 設定済みのときだけ true。
 * 本番Prod env にこれらを置かなければ常に false ＝ /demo も /api/demo/login も 404。
 */
export function isDemoLoginEnabled(): boolean {
  // ★保険: Vercel Production では env 設定に関わらず必ず無効（人為的な誤設定でも開かない）。
  //   Preview は VERCEL_ENV==="preview"、ローカルは未定義なので従来どおり env で判定する。
  //   （NODE_ENV は Preview も "production" になるため使わない＝Preview まで無効化しない）
  if (process.env.VERCEL_ENV === "production") return false;
  return (
    process.env.DEMO_LOGIN_ENABLED === "true" &&
    typeof process.env.DEMO_LOGIN_SECRET === "string" &&
    // .trim() 済みで判定（改行/空白のみの値は「未設定」とみなす）
    process.env.DEMO_LOGIN_SECRET.trim().length > 0
  );
}

/**
 * シークレット照合（定数時間）。両者を SHA-256 に通してから timingSafeEqual で比較し、
 * 長さの差もリークさせない。secret 未設定や不一致は false。
 * env 側・入力側とも .trim() してから比較する（末尾の改行/空白による誤不一致を防ぐ）。
 */
export function verifyDemoKey(provided: unknown): boolean {
  const secret = process.env.DEMO_LOGIN_SECRET?.trim();
  if (!secret || typeof provided !== "string") {
    return false;
  }
  const input = provided.trim();
  if (input.length === 0) {
    return false;
  }
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}
