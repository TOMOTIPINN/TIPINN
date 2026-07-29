-- SECURITY DEFINER 関数の PUBLIC(anon/authenticated) 実行権を剥奪する。
--
-- 背景: Postgres は CREATE FUNCTION 時に PUBLIC へ EXECUTE を自動付与する。
--       submit_review_and_earn_stamp / submit_visit_and_earn_stamp の2本のみ
--       明示 REVOKE 済みで、残り7本が既定のまま anon から実行可能だった。
--       特に void_reward_redemption は anon から叩けると
--       「消込→void→再消込」でリワードを無限に受け取れる状態だった。
--
-- 影響: 全 RPC は supabaseAdmin(service_role) 経由（src/app/api/**, src/lib/rewards.ts）
--       のため、クライアントからの直接呼び出しは存在せず、アプリ影響なし。
--
-- 注意: revoke と grant はセット。ACL が既定(null)の関数は PUBLIC 経由で
--       service_role も実行できているため、revoke 単独では全機能が停止する。
--
-- 2026-07-29 ファウンディングサロン投入前の RLS/権限監査で発見。

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant  execute on function %s to service_role', r.sig);
  end loop;
end $$;
