import { createClient } from "@supabase/supabase-js";

/**
 * Supabase service-role クライアント（サーバー専用）。
 *
 * SUPABASE_SECRET_KEY は RLS をバイパスする。
 * 絶対にクライアントコンポーネントから import しないこと（原則8: 個人情報保護）。
 * フェーズ1で RLS は deny-by-default のため、サーバールートからの全DB操作はこの
 * クライアントを通し、必ず customer_id / salon_id でスコープすること。
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

export const supabaseAdmin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
