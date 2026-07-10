-- 0021 — 来店リマインド enqueue の復旧（notification_outbox への INSERT を再統合）
-- 準拠: CLAUDE.md §3（migration は SQLエディタで手動適用・db push は使わない）/ §4 RLS deny-by-default
--       0014（来店後リマインド outbox）/ 0019（累計一本化 COUNT+SUM(delta)）
--
-- 背景（回帰の修正）:
--   0014 が submit_visit_and_earn_stamp に「初回来店時 → notification_outbox へ enqueue」を
--   持たせたが、その後 0019 が同関数を drop→再定義した際に enqueue ブロックが脱落した。
--   結果、0019 適用以降は stamp_awarded=true でも outbox に一切積まれず、来店リマインドが
--   飛ばなくなっていた（本番 prosrc に notification_outbox INSERT が無いことを確認済み）。
--
-- 本 migration の内容（最小差分・0019 本文をベースに enqueue のみ再統合）:
--   ・declare に v_after integer; を追加。
--   ・v_awarded 算出後・return next の手前に、0014 と同一の enqueue ブロックを再統合。
--     - 条件は stamp_awarded=true（＝当日初回来店 INSERT）のみ。
--     - notify_at = 来店時刻(now) + salons.notify_after_minutes（無ければ 180分）。
--     - unique(customer_id, salon_id, visited_on, kind) に on conflict do nothing（二重予約無視）。
--   ・累計（COUNT(visits) + SUM(stamp_adjustments.delta)）・stamp_awarded・security definer・
--     advisory lock・search_path・revoke/grant は 0019 のまま一切変更しない。
--   ・適用は Supabase SQLエディタで手動。

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
  v_adj     integer;
  v_after   integer;
begin
  -- 同一 (顧客, サロン) の同時アクセスを直列化し、1日1回ルールの競合を防ぐ（0004/0009と同じ）。
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

  -- 初回来店のときだけ、感想リマインドを outbox に予約（原子的・0014 の再統合）。
  -- notify_at = 来店時刻(now) + salons.notify_after_minutes。unique で二重予約は無視。
  if v_awarded then
    select notify_after_minutes into v_after
    from public.salons where id = p_salon_id;

    insert into public.notification_outbox
      (customer_id, salon_id, kind, visited_on, notify_at)
    values
      (p_customer_id, p_salon_id, 'visit_review_request', v_today,
       now() + make_interval(mins => coalesce(v_after, 180)))
    on conflict (customer_id, salon_id, visited_on, kind) do nothing;
  end if;

  -- 実来店の累計（リセットしない COUNT(*)）。
  select count(*) into v_count
  from public.visits
  where customer_id = p_customer_id
    and salon_id    = p_salon_id;

  -- 移行オフセット（旧カード残高）。無ければ 0。累計を1式に一本化する加算項。
  select coalesce(sum(delta), 0) into v_adj
  from public.stamp_adjustments
  where customer_id = p_customer_id
    and salon_id    = p_salon_id;

  new_count     := v_count + v_adj;
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
