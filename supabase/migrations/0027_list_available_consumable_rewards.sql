-- 本番適用済み（2026-07-16〜17・SQL Editor 手動）。ファイルは事後記録。
-- ⚠️ このファイルを再実行しないこと。本番には既に存在する。

CREATE OR REPLACE FUNCTION public.list_available_consumable_rewards(p_customer_id uuid, p_salon_id uuid)
 RETURNS TABLE(reward_id uuid, title text, cycle_axis text, cycle_index integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_today         date;
  v_visit_id      uuid;
  v_stamps        integer;
  v_review_cycles integer;
  v_axis_on       boolean;
  v_visit_size    integer;
  v_visit_total   integer;
  v_visit_cycles  integer;
begin
  v_today := (now() at time zone 'Asia/Tokyo')::date;

  -- 本日の来店。無ければ消込対象そのものが無い（消込は「本日の来店」に紐づく）。
  select id into v_visit_id
  from public.visits
  where customer_id = p_customer_id
    and salon_id    = p_salon_id
    and visited_on  = v_today;

  if v_visit_id is null then
    return;
  end if;

  -- 1来店につき消費型は最大1回。本日ぶんが既に消込済みなら候補ゼロ。
  -- reward_redemptions_one_per_visit（部分unique）と同じ規則をここに一本化する
  -- （ボタンは出るのに押すと unique_violation、を防ぐ）。
  if exists (
    select 1 from public.reward_redemptions
    where visit_id = v_visit_id and voided_at is null
  ) then
    return;
  end if;

  -- 感想軸のサイクル数（vip.ts の cyclesCompleted と同一式）。
  select coalesce(es.count, 0) into v_stamps
  from public.earned_stamps es
  where es.customer_id = p_customer_id and es.salon_id = p_salon_id;

  v_review_cycles := floor(coalesce(v_stamps, 0) / 3);

  -- 来店軸。salons.visit_axis_enabled が真のときだけ存在する。
  -- サイクル幅は per-salon（salons.visit_cycle_size・既定20）。感想軸の3とは別物。
  select s.visit_axis_enabled, s.visit_cycle_size
    into v_axis_on, v_visit_size
  from public.salons s where s.id = p_salon_id;

  v_visit_cycles := 0;
  if coalesce(v_axis_on, false) then
    -- 累計 = 実来店 + 移行delta（submit_visit_and_earn_stamp / mypage / api と同一式）。
    select count(*) into v_visit_total
    from public.visits v
    where v.customer_id = p_customer_id and v.salon_id = p_salon_id;

    select v_visit_total + coalesce(sum(sa.delta), 0) into v_visit_total
    from public.stamp_adjustments sa
    where sa.customer_id = p_customer_id and sa.salon_id = p_salon_id;

    v_visit_cycles := floor(v_visit_total / greatest(coalesce(v_visit_size, 20), 1));
  end if;

  -- 特典ごとに1件。消費順は【感想軸 → 来店軸】固定、各軸内は FIFO（未消込の最小 cycle_index）。
  --   軸順の理由: 感想軸は回転が速く（3件ごと）貯まりやすいため、先に消して滞留を防ぐ。
  --   軸をスタッフに選ばせない理由: 軸は現実に対応物が無い帳簿上の概念。見えないものを選ばせると
  --   押下がランダムになる＝規則で決めた方が正確。
  --   FIFO の理由:「残りは次回持ち越し」の語義そのまま。
  -- どの特典を使うかは呼び出し側（UI）が選ぶ＝顧客との実在の会話なので、ここでは絞らない。
  return query
  select r.id, r.title, c.axis, c.idx
  from public.rewards r
  cross join lateral (
    select a.axis, a.idx
    from (
      -- 感想軸の未消込サイクル（axis_order=1 で先に来る）
      select 'review'::text as axis, i as idx, 1 as axis_order
      from generate_series(1, v_review_cycles) i
      where not exists (
        select 1 from public.reward_redemptions rr
        where rr.customer_id = p_customer_id and rr.salon_id = p_salon_id
          and rr.reward_id = r.id and rr.cycle_axis = 'review'
          and rr.cycle_index = i and rr.voided_at is null
      )
      union all
      -- 来店軸の未消込サイクル
      select 'visit'::text, i, 2
      from generate_series(1, v_visit_cycles) i
      where not exists (
        select 1 from public.reward_redemptions rr
        where rr.customer_id = p_customer_id and rr.salon_id = p_salon_id
          and rr.reward_id = r.id and rr.cycle_axis = 'visit'
          and rr.cycle_index = i and rr.voided_at is null
      )
    ) a
    order by a.axis_order, a.idx
    limit 1
  ) c
  where r.salon_id = p_salon_id
    and r.is_consumable = true
  order by r.created_at;  -- 表示順は manager の作成順（rewards.ts の .order と揃える）
end;
$function$
