-- 本番適用済み（2026-07-16〜17・SQL Editor 手動）。ファイルは事後記録。
-- ⚠️ このファイルを再実行しないこと。本番には既に存在する。

CREATE OR REPLACE FUNCTION public.redeem_reward(p_customer_id uuid, p_salon_id uuid, p_reward_id uuid, p_staff_id uuid)
 RETURNS TABLE(ok boolean, reason text, redemption_id uuid, cycle_axis text, cycle_index integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_today    date;
  v_visit_id uuid;
  v_axis     text;
  v_index    integer;
  v_id       uuid;
begin
  -- 同一(顧客,サロン)を直列化。submit_visit_and_earn_stamp と同じキー体系で、
  -- チェックイン直後の消込が来店行の可視性で競合しないようにする。
  perform pg_advisory_xact_lock(
    hashtextextended(p_customer_id::text || ':' || p_salon_id::text, 0)
  );

  v_today := (now() at time zone 'Asia/Tokyo')::date;

  -- 消込は「本日の来店」に紐づく。チェックイン前は消せない。
  select id into v_visit_id
  from public.visits
  where customer_id = p_customer_id
    and salon_id    = p_salon_id
    and visited_on  = v_today;

  if v_visit_id is null then
    ok := false; reason := 'no_visit_today';
    redemption_id := null; cycle_axis := null; cycle_index := null;
    return next; return;
  end if;

  -- 候補は list_available_consumable_rewards が決める（軸順・FIFO・1来店1消費・is_consumable 判定は
  -- 全てあちら側＝唯一の正）。ここで p_reward_id を絞ることで「その特典に使えるサイクルがあるか」も
  -- 同時に検証される。
  select l.cycle_axis, l.cycle_index into v_axis, v_index
  from public.list_available_consumable_rewards(p_customer_id, p_salon_id) l
  where l.reward_id = p_reward_id;

  if v_index is null then
    -- 特典が存在しない / 他店のもの / 状態型 / 使えるサイクルが無い / 本日消込済み、を全て含む。
    ok := false; reason := 'no_available_reward';
    redemption_id := null; cycle_axis := null; cycle_index := null;
    return next; return;
  end if;

  -- ⚠️ redeemed_by は端末（iPad）経路では null になる。getVisitContext の device 経路は
  --   個人を特定できないため（stamp_adjustments.created_by と同じ割り切り・2026-07-17 決定）。
  begin
    insert into public.reward_redemptions
      (customer_id, salon_id, reward_id, visit_id, cycle_axis, cycle_index, redeemed_by)
    values
      (p_customer_id, p_salon_id, p_reward_id, v_visit_id, v_axis, v_index, p_staff_id)
    returning id into v_id;
  exception
    when unique_violation then
      -- 二重押下・別端末の同時押下。部分unique（active_uniq / one_per_visit）が最終防衛線。
      -- Postgres が投げる例外なので戻り値にはできない → ここで捕まえて reason に変換し、
      -- 呼び出し側から見た形を他の想定内ケースと揃える。
      ok := false; reason := 'already_redeemed_today';
      redemption_id := null; cycle_axis := null; cycle_index := null;
      return next; return;
  end;

  ok := true; reason := null;
  redemption_id := v_id;
  cycle_axis    := v_axis;
  cycle_index   := v_index;
  return next;
end;
$function$
