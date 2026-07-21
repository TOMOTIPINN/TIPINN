-- =========================================================
-- 0032_require_visit_for_review.sql
-- submit_review_and_earn_stamp に「来店裏付けチェック」を追加。
-- 目的: 感想は「今日(JST)この顧客がこのサロンに来店(visits行あり)」の場合のみ受付。
--       LINE永続リンクを保存して来店なしに感想を送る farming を防ぐ。
-- =========================================================

create or replace function public.submit_review_and_earn_stamp(
  p_customer_id uuid,
  p_salon_id    uuid,
  p_staff_id    uuid,
  p_body        text,
  p_rating      integer,
  p_tags        text[],
  p_share_scope text
)
returns table (review_id uuid, new_count integer, stamp_awarded boolean, already_submitted boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review_id uuid;
  v_existing  integer;
  v_count     integer;
begin
  if p_rating is null or p_rating < 1 or p_rating > 4 then
    raise exception 'invalid rating: %', p_rating;
  end if;
  if p_share_scope is null or p_share_scope not in ('manager_only','everyone','either') then
    raise exception 'invalid share_scope: %', p_share_scope;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_customer_id::text || ':' || p_salon_id::text, 0)
  );

  -- 0032 追加: 来店裏付けチェック。今日(JST)この(顧客,サロン)の visits 行が無ければ弾く。
  if not exists (
    select 1 from public.visits
    where customer_id = p_customer_id
      and salon_id    = p_salon_id
      and visited_on  = (now() at time zone 'Asia/Tokyo')::date
  ) then
    raise exception 'no_visit_today';
  end if;

  select count(*) into v_existing
  from public.reviews
  where customer_id = p_customer_id
    and salon_id    = p_salon_id
    and (created_at at time zone 'Asia/Tokyo')::date
      = (now() at time zone 'Asia/Tokyo')::date;

  if v_existing > 0 then
    select coalesce(es.count, 0) into v_count
    from public.earned_stamps es
    where es.customer_id = p_customer_id and es.salon_id = p_salon_id;

    review_id         := null;
    new_count         := coalesce(v_count, 0);
    stamp_awarded     := false;
    already_submitted := true;
    return next;
    return;
  end if;

  insert into public.reviews
    (customer_id, salon_id, staff_id, body, rating, tags, share_scope)
  values
    (p_customer_id, p_salon_id, p_staff_id, p_body, p_rating,
     coalesce(p_tags, '{}'), p_share_scope)
  returning id into v_review_id;

  insert into public.earned_stamps (customer_id, salon_id, count, updated_at)
  values (p_customer_id, p_salon_id, 1, now())
  on conflict (customer_id, salon_id)
  do update set count = public.earned_stamps.count + 1, updated_at = now()
  returning count into v_count;

  review_id         := v_review_id;
  new_count         := v_count;
  stamp_awarded     := true;
  already_submitted := false;
  return next;
end;
$$;

revoke all on function
  public.submit_review_and_earn_stamp(uuid, uuid, uuid, text, integer, text[], text)
  from public;
grant execute on function
  public.submit_review_and_earn_stamp(uuid, uuid, uuid, text, integer, text[], text)
  to service_role;
