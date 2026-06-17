-- 0004 — 感想フロー仕様化（画面マップ03 / 06）
-- 準拠: CLAUDE.md §3-§5・絶対原則
--   ・reviews に rating / tags / share_scope を追加（無償レビューの構造化）
--   ・貯まるスタンプは「1個 / 顧客 / サロン / 日(JST)」に制限
--   ・RPC submit_review_and_earn_stamp を上記対応＋戻り値に stamp_awarded を追加
--   ・RLS は deny-by-default（0001の方針）を一切変更しない。service_role のみ実行。

-- =========================================================
-- 1) reviews に列を追加
--   既存行を壊さないため列は nullable + null許容CHECK。
--   非nullの強制はRPC側（アプリ経路の最後の砦）で行う。
-- =========================================================
alter table public.reviews
  add column if not exists rating      integer,
  add column if not exists tags        text[] not null default '{}',
  add column if not exists share_scope text;

alter table public.reviews
  drop constraint if exists reviews_rating_check;
alter table public.reviews
  add  constraint reviews_rating_check
  check (rating is null or rating between 1 and 4);  -- 4=最高 / 3=よい / 2=普通 / 1=改善

alter table public.reviews
  drop constraint if exists reviews_share_scope_check;
alter table public.reviews
  add  constraint reviews_share_scope_check
  check (share_scope is null or share_scope in ('manager_only','everyone','either'));

-- =========================================================
-- 2) RPC を作り直す（引数・戻り値が変わるため drop して再作成）
--   旧シグネチャ: (uuid,uuid,uuid,text) → (review_id, new_count)
--   新シグネチャ: + p_rating,p_tags,p_share_scope / 戻り値に stamp_awarded
-- =========================================================
drop function if exists public.submit_review_and_earn_stamp(uuid, uuid, uuid, text);
drop function if exists public.submit_review_and_earn_stamp(uuid, uuid, uuid, text, integer, text[], text);

create function public.submit_review_and_earn_stamp(
  p_customer_id uuid,
  p_salon_id    uuid,
  p_staff_id    uuid,
  p_body        text,
  p_rating      integer,
  p_tags        text[],
  p_share_scope text
)
returns table (review_id uuid, new_count integer, stamp_awarded boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review_id   uuid;
  v_today_count integer;
  v_count       integer;
  v_awarded     boolean;
begin
  -- 入力検証（DB側の最後の砦）
  if p_rating is null or p_rating < 1 or p_rating > 4 then
    raise exception 'invalid rating: %', p_rating;
  end if;
  if p_share_scope is null or p_share_scope not in ('manager_only','everyone','either') then
    raise exception 'invalid share_scope: %', p_share_scope;
  end if;

  -- 同一 (顧客, サロン) の同時送信を直列化し、1日1個ルールの競合を防ぐ
  perform pg_advisory_xact_lock(
    hashtextextended(p_customer_id::text || ':' || p_salon_id::text, 0)
  );

  insert into public.reviews
    (customer_id, salon_id, staff_id, body, rating, tags, share_scope)
  values
    (p_customer_id, p_salon_id, p_staff_id, p_body, p_rating,
     coalesce(p_tags, '{}'), p_share_scope)
  returning id into v_review_id;

  -- スタンプは「1個 / 顧客 / サロン / 日(JST)」。
  -- 今日(Asia/Tokyo)この(顧客,サロン)の最初のレビューなら付与する。
  select count(*) into v_today_count
  from public.reviews
  where customer_id = p_customer_id
    and salon_id    = p_salon_id
    and (created_at at time zone 'Asia/Tokyo')::date
        = (now()       at time zone 'Asia/Tokyo')::date;

  v_awarded := (v_today_count = 1);  -- 直前のINSERT分のみ＝今日の初回

  if v_awarded then
    insert into public.earned_stamps (customer_id, salon_id, count, updated_at)
    values (p_customer_id, p_salon_id, 1, now())
    on conflict (customer_id, salon_id)
    do update set count = public.earned_stamps.count + 1, updated_at = now()
    returning count into v_count;
  else
    select coalesce(es.count, 0) into v_count
    from public.earned_stamps es
    where es.customer_id = p_customer_id and es.salon_id = p_salon_id;
    v_count := coalesce(v_count, 0);
  end if;

  review_id     := v_review_id;
  new_count     := v_count;
  stamp_awarded := v_awarded;
  return next;
end;
$$;

-- deny-by-default を維持: PUBLIC/anon/authenticated からは実行不可、service_role のみ。
revoke all on function
  public.submit_review_and_earn_stamp(uuid, uuid, uuid, text, integer, text[], text)
  from public;
grant execute on function
  public.submit_review_and_earn_stamp(uuid, uuid, uuid, text, integer, text[], text)
  to service_role;
