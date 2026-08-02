import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * 認証試行の記録とレート制限（migration 0037 `public.login_attempts`）。
 *
 * 方針:
 *  ・記録側の障害で「認証を止めない」。insert 失敗も count 失敗も握りつぶして
 *    console.error のみ（@/lib/line-messaging の pushText と同じ・例外を投げない）。
 *  ・login_attempts は RLS 完全deny（0037）。読み書きは service_role のみ＝この
 *    モジュール経由に閉じる（管理画面から直接読ませる導線は作らない）。
 *  ・detail には**生のトークン・state・鍵・LINEのcode を絶対に入れない**。
 *    'state_mismatch' 'token_invalid' のような分類語だけを渡すこと（PII・秘密値は
 *    30日間 DB に残るため、ここが漏れると記録そのものが攻撃面になる）。
 */
export type Scope = "line_callback" | "staff_bind" | "demo_login";

/**
 * 集計窓＝直近1時間。
 * 通知本文（@/lib/security-alert）が「直近◯時間」を書くためにも読む＝ここが唯一の正。
 */
export const WINDOW_MS = 60 * 60 * 1000;

/**
 * scope ごとの失敗回数しきい値（この件数**以上**でブロック）。
 * 通知本文（@/lib/security-alert）が閾値を書くためにも読む＝ここが唯一の正。
 * 値を変えると通知文も自動で追従する（数字を2箇所に持たない）。
 */
export const FAILURE_LIMIT: Record<Scope, number> = {
  staff_bind: 20,
  demo_login: 10,
  line_callback: 30,
};

/** IP が取れない／inet として不正なときのフォールバック。 */
const UNKNOWN_IP = "0.0.0.0";

/** detail の上限。分類語しか入れない前提だが、将来の誤用で本文が丸ごと入るのを防ぐ。 */
const DETAIL_MAX = 200;

/**
 * inet 列に入れて安全な形かを検証する。
 * 不正な文字列を渡すと insert が `invalid input syntax for type inet` で失敗し、
 * **記録が丸ごと落ちる＝しきい値に到達しなくなる**ため、怪しい値は UNKNOWN_IP に畳む。
 */
function isIpLike(v: string): boolean {
  // IPv4 dotted-quad（各オクテット 0-255）
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) {
    return v.split(".").every((o) => Number(o) <= 255);
  }
  // IPv6（16進とコロン、IPv4射影の '.' まで許す。長さは inet 側の検証に委ねる）
  return v.includes(":") && /^[0-9a-fA-F:.]+$/.test(v);
}

/**
 * クライアント IP を x-forwarded-for の**先頭**から取る（Vercel が付与する）。
 * 取れない／IP として不正なら UNKNOWN_IP。
 */
function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (!xff) return UNKNOWN_IP;
  let first = xff.split(",")[0]?.trim() ?? "";
  if (!first) return UNKNOWN_IP;
  // "[2001:db8::1]:443" / "1.2.3.4:443" のような port 付き表記を素の IP に戻す。
  const bracketed = first.match(/^\[(.+)\](?::\d+)?$/);
  if (bracketed) first = bracketed[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(first)) first = first.split(":")[0];
  return isIpLike(first) ? first : UNKNOWN_IP;
}

/**
 * 通知本文（@/lib/security-alert）に載せる IP を解決する。
 *
 * clientIp 自体は **private のまま**にする（IP の正規化・inet 検証はこのモジュールの
 * 責務で、外に配ると各所で独自の取り方が生えて記録と通知で値がズレる）。
 * 「通知に載せる IP は記録した IP と必ず同一」を保つための、用途を限定した唯一の窓口。
 */
export function attemptClientIp(req: Request): string {
  return clientIp(req);
}

/**
 * 認証試行を1件記録する。**例外は投げない**（呼び出し側の認証フローを絶対に壊さない）。
 * detail は分類語のみ（上のモジュールコメント参照）。
 */
export async function recordAttempt(
  req: Request,
  scope: Scope,
  succeeded: boolean,
  detail?: string,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("login_attempts").insert({
      scope,
      ip: clientIp(req),
      succeeded,
      detail: detail ? detail.slice(0, DETAIL_MAX) : null,
    });
    if (error) {
      console.error(`[login-attempts] insert failed scope=${scope}`, error);
    }
  } catch (e) {
    console.error(`[login-attempts] insert threw scope=${scope}`, e);
  }
}

/**
 * 同一 IP・同一 scope の**失敗**が直近1時間でしきい値に達しているか。
 * エラー時は false（＝通す）。記録側の障害で正規のログインを止めない。
 */
export async function isThrottled(req: Request, scope: Scope): Promise<boolean> {
  try {
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const { count, error } = await supabaseAdmin
      .from("login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("scope", scope)
      .eq("ip", clientIp(req))
      .eq("succeeded", false)
      .gte("created_at", since);

    if (error) {
      console.error(`[login-attempts] count failed scope=${scope}`, error);
      return false;
    }
    return (count ?? 0) >= FAILURE_LIMIT[scope];
  } catch (e) {
    console.error(`[login-attempts] count threw scope=${scope}`, e);
    return false;
  }
}
