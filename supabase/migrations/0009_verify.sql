-- 0009 検証クエリ（来店スタンプ軸 / Phase 7）
-- 本体（0009_apply_body.sql）を Supabase SQL エディタで Run した後に、これを実行して確認する。
-- ※ これはマイグレーション本体ではない。スキーマ変更は含まない（確認＋ROLLBACK付きテストのみ）。
-- ※ CHECK違反テスト(③)とRPCスモーク(⑥)は begin;...rollback; で囲み、実データを汚さない。

-- ① salons に3列が入ったか（3行返ればOK）
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_name = 'salons'
  and column_name in ('visit_axis_enabled', 'visit_cycle_size', 'visit_token')
order by column_name;

-- ② visit_token が全行ユニークか（total = uniq = non_null ならOK）
select count(*)                    as total,
       count(distinct visit_token) as uniq,
       count(visit_token)          as non_null
from public.salons;

-- ③ CHECK違反テスト：21 は弾かれるべき（ROLLBACKで戻す）
--    期待＝ ERROR: new row ... violates check constraint "salons_visit_cycle_size_check"
begin;
  update public.salons set visit_cycle_size = 21
  where id = (select id from public.salons limit 1);
rollback;

-- ④ visits の unique(customer_id, salon_id, visited_on) があるか
--    contype 'u' の行に {customer_id, salon_id, visited_on} が並べばOK
select c.conname,
       c.contype,
       (select string_agg(a.attname, ', ' order by k.ord)
        from unnest(c.conkey) with ordinality as k(attnum, ord)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as columns
from pg_constraint c
where c.conrelid = 'public.visits'::regclass
order by c.contype;

-- ⑤ RPC が存在し service_role に execute 付与されているか
--    1行返り has_execute = true ならOK
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef                               as security_definer,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as has_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'submit_visit_and_earn_stamp';

-- ⑥（任意）RPCスモーク：1回目 awarded=true / 同日2回目 false・new_count据え置き。必ずROLLBACK。
--    '<customer_uuid>' '<salon_uuid>' を実在IDに置換。実データは作らず巻き戻す。
begin;
  select * from public.submit_visit_and_earn_stamp('<customer_uuid>', '<salon_uuid>');
  select * from public.submit_visit_and_earn_stamp('<customer_uuid>', '<salon_uuid>');
rollback;
