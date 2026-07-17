-- 本番に既存（適用日不明）。2026-07-17 の監査で発見し事後記録。
-- ⚠️ このファイルを再実行しないこと。本番には既に存在する。
-- 出所: migrations・CLAUDE.md・docs のいずれにも記録が無く、owner=postgres。
--   Supabase の Security Advisor / AI Assistant の Fix 由来と推定。
-- ⚠️ これは稼働中（pg_event_trigger: ensure_rls / evtenabled='O'）。
--   public に create table すると、その場で RLS が自動 enable される。
--   ポリシーを書かなければ完全deny。ただし service_role は RLS をバイパスするため
--   書き込み・RPC は通り、気づきにくい（0025 reward_redemptions が実際にこの状態）。
--   失敗しても RAISE LOG のみで画面に出ない。

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

-- CREATE EVENT TRIGGER ensure_rls
--   ON ddl_command_end
--   EXECUTE FUNCTION public.rls_auto_enable();
-- ↑ 本番に既存のため コメントアウト。再実行しないこと（重複作成でエラーになる）。