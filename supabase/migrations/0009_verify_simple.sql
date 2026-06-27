-- 0009 簡易検証（来店スタンプ軸 / Phase 7）
-- 本体（0009_apply_body.sql）を Supabase SQL エディタで Run した後に、これを1回流すだけで一括確認できる。
-- ※ マイグレーション本体ではない。読み取り専用の安全なSELECTのみ（CHECK違反テスト・RPCスモークは含まない）。
-- 判定: 返る1行の all_ok = true なら全項目合格。
--   cols_present = 3 / token_all_unique = true / rpc_exists = true / rpc_grant = true

with checks as (
  select
    (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'salons'
         and column_name in ('visit_axis_enabled', 'visit_cycle_size', 'visit_token'))
      as cols_present,                                   -- 3 を期待
    (select count(*) from public.salons)                    as token_total,
    (select count(distinct visit_token) from public.salons) as token_uniq,
    (select count(visit_token) from public.salons)          as token_non_null,
    (to_regprocedure('public.submit_visit_and_earn_stamp(uuid,uuid)') is not null)
      as rpc_exists,
    coalesce(
      has_function_privilege(
        'service_role',
        to_regprocedure('public.submit_visit_and_earn_stamp(uuid,uuid)')::oid,
        'EXECUTE'),
      false)                                                as rpc_grant
)
select
  cols_present,
  token_total,
  token_uniq,
  token_non_null,
  (token_total = token_uniq and token_total = token_non_null) as token_all_unique,
  rpc_exists,
  rpc_grant,
  (cols_present = 3
   and token_total = token_uniq
   and token_total = token_non_null
   and rpc_exists
   and rpc_grant)                                            as all_ok
from checks;
