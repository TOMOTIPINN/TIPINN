-- 0009 本体（適用用・検証クエリ抜き） — 来店スタンプ軸（Visit axis / Phase 7）
-- これを Supabase SQL エディタに貼って Run する。検証は別ファイル/別クエリで実施。
-- 内容は supabase/migrations/0009_visit_axis.sql の本体と一致。

-- =========================================================
-- 1) salons に来店軸の列を追加
--    visit_token は volatile default のため既存行も1行ずつ評価され、全行にユニーク値が入る。
-- =========================================================
alter table public.salons
  add column if not exists visit_axis_enabled boolean not null default false,
  add column if not exists visit_cycle_size   integer not null default 20,
  add column if not exists visit_token         text    not null
    default encode(gen_random_bytes(16), 'hex');

alter table public.salons
  drop constraint if exists salons_visit_cycle_size_check;
alter table public.salons
  add  constraint salons_visit_cycle_size_check
  check (visit_cycle_size between 10 and 20);

-- =========================================================
-- 2) visits（来店記録・単一テーブル / 累計＝COUNT(*) 方式）
--    1日1回は unique(customer_id, salon_id, visited_on) でDB担保。
--    visited_on は JST(Asia/Tokyo)日付。累計はリセットせず行が積み上がる。
-- =========================================================
create table if not exists public.visits (
  id          uuid        not null default gen_random_uuid() primary key,
  customer_id uuid        not null references public.customers(id) on delete cascade,
  salon_id    uuid        not null references public.salons(id)    on delete cascade,
  visited_on  date        not null,  -- JST(Asia/Tokyo)の暦日
  created_at  timestamptz not null default now(),
  unique (customer_id, salon_id, visited_on)
);

create index if not exists idx_visits_customer_salon
  on public.visits(customer_id, salon_id);
create index if not exists idx_visits_salon
  on public.visits(salon_id);

-- RLS: deny-by-default（0001方針）。ポリシーを作らない＝anon/authenticated 遮断・service_role のみ。
alter table public.visits enable row level security;

-- =========================================================
-- 3) RPC submit_visit_and_earn_stamp（感想RPC 0004 と同型）
--    今日(JST)この(顧客,サロン)の初回来店だけ記録＝累計+1。2回目以降は記録せずカウント据え置き。
--    戻り値: new_count（累計＝COUNT(*)）, stamp_awarded（今回付与されたか）。
-- =========================================================
drop function if exists public.submit_visit_and_earn_stamp(uuid, uuid);

create function public.submit_visit_and_earn_stamp(
  p_customer_id uuid,
  p_salon_id    uuid
)
returns table (new_count integer, stamp_awarded boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today   date;
  v_id      uuid;
  v_awarded boolean;
  v_count   integer;
begin
  -- 同一 (顧客, サロン) の同時アクセスを直列化し、1日1回ルールの競合を防ぐ（0004と同じ）。
  perform pg_advisory_xact_lock(
    hashtextextended(p_customer_id::text || ':' || p_salon_id::text, 0)
  );

  v_today := (now() at time zone 'Asia/Tokyo')::date;

  -- 今日(JST)この(顧客,サロン)の初回だけ INSERT 成功。2回目以降は conflict で何もしない。
  insert into public.visits (customer_id, salon_id, visited_on)
  values (p_customer_id, p_salon_id, v_today)
  on conflict (customer_id, salon_id, visited_on) do nothing
  returning id into v_id;

  v_awarded := v_id is not null;  -- INSERTできた＝今日の初回

  -- 累計は awarded 有無に関わらず COUNT(*) で再取得（リセットしない累積値）。
  select count(*) into v_count
  from public.visits
  where customer_id = p_customer_id
    and salon_id    = p_salon_id;

  new_count     := v_count;
  stamp_awarded := v_awarded;
  return next;
end;
$$;

-- deny-by-default を維持: PUBLIC/anon/authenticated からは実行不可、service_role のみ。
revoke all on function
  public.submit_visit_and_earn_stamp(uuid, uuid)
  from public;
grant execute on function
  public.submit_visit_and_earn_stamp(uuid, uuid)
  to service_role;
