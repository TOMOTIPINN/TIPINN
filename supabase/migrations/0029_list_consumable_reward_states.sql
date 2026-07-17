-- 本番適用済み（2026-07-16〜17・SQL Editor 手動）。ファイルは事後記録。
-- ⚠️ このファイルを再実行しないこと。本番には既に存在する。

CREATE OR REPLACE FUNCTION public.list_consumable_reward_states(p_customer_id uuid, p_salon_id uuid)
 RETURNS TABLE(reward_id uuid, title text, earned_count integer, redeemed_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_stamps        integer;
  v_review_cycles integer;
  v_axis_on       boolean;
  v_visit_size    integer;
  v_visit_total   integer;
  v_visit_cycles  integer;
begin
  -- 感想軸のサイクル数（vip.ts の cyclesCompleted と同一式・0027 と同一）。
  select coalesce(es.count, 0) into v_stamps
  from public.earned_stamps es
  where es.customer_id = p_customer_id and es.salon_id = p_salon_id;

  v_review_cycles := floor(coalesce(v_stamps, 0) / 3);

  -- 来店軸。salons.visit_axis_enabled が真のときだけ存在する（visit.ts と同一式・0027 と同一）。
  select s.visit_axis_enabled, s.visit_cycle_size
    into v_axis_on, v_visit_size
  from public.salons s where s.id = p_salon_id;

  v_visit_cycles := 0;
  if coalesce(v_axis_on, false) then
    -- 累計 = 実来店 + 移行delta（1式一本化）。
    select count(*) into v_visit_total
    from public.visits v
    where v.customer_id = p_customer_id and v.salon_id = p_salon_id;

    select v_visit_total + coalesce(sum(sa.delta), 0) into v_visit_total
    from public.stamp_adjustments sa
    where sa.customer_id = p_customer_id and sa.salon_id = p_salon_id;

    v_visit_cycles := floor(v_visit_total / greatest(coalesce(v_visit_size, 20), 1));
  end if;

  return query
  select
    r.id,
    r.title,
    -- 消費型は「セット付与」＝サイクルが1周するごとに各特典が1個ずつ発生する（rewards.ts）。
    -- よって earn 総数 = 感想軸のサイクル数 + 来店軸のサイクル数。
    -- ⚠️ 状態型（権利）は感想軸のみだが、この関数は is_consumable=true しか返さないので
    --   ここでの両軸合算は消費型に限った話。軸ごとの適用範囲は 0027 のコメント参照。
    (v_review_cycles + v_visit_cycles)::integer,
    (
      select count(*)
      from public.reward_redemptions rr
      where rr.customer_id = p_customer_id
        and rr.salon_id    = p_salon_id
        and rr.reward_id   = r.id
        and rr.voided_at is null
    )::integer
  from public.rewards r
  where r.salon_id = p_salon_id
    and r.is_consumable = true
  order by r.created_at;  -- 表示順は manager の作成順（rewards.ts の .order と揃える）
end;
$function$
