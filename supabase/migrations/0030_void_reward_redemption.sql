-- 本番適用済み（2026-07-17・SQL Editor 手動）。ファイルは事後記録。
-- ⚠️ このファイルを再実行しないこと。本番には既に存在する。
-- 0030: 消込の取消UI 用（2026-07-17）
-- get_todays_redemption … done画面の分岐用（読み取り専用）
-- void_reward_redemption … 本日の消込を1件 void する

CREATE OR REPLACE FUNCTION public.get_todays_redemption(p_customer_id uuid, p_salon_id uuid)
 RETURNS TABLE(redemption_id uuid, reward_id uuid, title text, cycle_axis text, cycle_index integer, redeemed_at timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare

  v_today    date;
  v_visit_id uuid;
begin
  -- ⚠️ 0027 と対（鉄則(c)と同じ構図）。
  --   0027 =「今この来店で何を消せるか」、この関数 =「今この来店で何を消したか」。
  --   本日の来店の引き方（v_today / visited_on）は 0027・0028 と一字一句そろえること。
  --   ズレると 0027 が候補ゼロ・この関数も0行 ＝ done画面が「候補なし」に落ちて取消不能になる。
  v_today := (now() at time zone 'Asia/Tokyo')::date;

  select id into v_visit_id
  from public.visits
  where customer_id = p_customer_id
    and salon_id    = p_salon_id
    and visited_on  = v_today;

  if v_visit_id is null then
    return;
  end if;

  -- reward_redemptions_one_per_visit（部分unique・WHERE voided_at IS NULL）により最大1件。
  -- cycle_axis / cycle_index は SQL 検証用。UI に出さないこと（軸は帳簿上の概念・回数は出さない）。
  return query
  select rr.id, rr.reward_id, r.title, rr.cycle_axis, rr.cycle_index, rr.redeemed_at
  from public.reward_redemptions rr
  join public.rewards r on r.id = rr.reward_id
  where rr.visit_id = v_visit_id
    and rr.voided_at is null;
end;
$function$;


CREATE OR REPLACE FUNCTION public.void_reward_redemption(p_customer_id uuid, p_salon_id uuid, p_staff_id uuid)
 RETURNS TABLE(ok boolean, reason text, reward_title text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_today    date;
  v_visit_id uuid;
  v_id       uuid;
  v_title    text;
begin
  -- 0027/0028 と同一キー体系。redeem と void を直列化する。
  perform pg_advisory_xact_lock(
    hashtextextended(p_customer_id::text || ':' || p_salon_id::text, 0)
  );

  v_today := (now() at time zone 'Asia/Tokyo')::date;

  -- 取消可能な範囲は【当日のみ】。done画面が「本日の来店」に紐づくため（2026-07-17 決定）。
  -- 前日ぶんの誤りは当面 SQL Editor で対応する。サロンが増えたら manager画面を作る。
  select id into v_visit_id
  from public.visits
  where customer_id = p_customer_id
    and salon_id    = p_salon_id
    and visited_on  = v_today;

  if v_visit_id is null then
    ok := false; reason := 'no_visit_today'; reward_title := null;
    return next; return;
  end if;

  select rr.id, r.title into v_id, v_title
  from public.reward_redemptions rr
  join public.rewards r on r.id = rr.reward_id
  where rr.visit_id = v_visit_id
    and rr.voided_at is null;

  if v_id is null then
    ok := false; reason := 'nothing_to_void'; reward_title := null;
    return next; return;
  end if;

  -- ⚠️ 権限判定なし。在籍staff・端末経路いずれも可（2026-07-17 決定）。
  --   redeemed_by は端末経路で null ＝「押した本人」を特定できないため、そもそも権限で縛れない。
  --   voided_by は追跡用に持つだけ（stamp_adjustments.created_by と同じ割り切り）。
  -- where voided_at is null が最終防衛線。advisory lock を取らない直接SQLと競合しても二重voidしない。
  update public.reward_redemptions
     set voided_at = now(), voided_by = p_staff_id
   where id = v_id
     and voided_at is null;

  if not found then
    ok := false; reason := 'nothing_to_void'; reward_title := null;
    return next; return;
  end if;

  -- 部分unique なので、void 後は同じ cycle を再消込できる（0025 の設計意図）。
  -- ＝ 0027 が候補を返す状態に戻り、done画面は自然に「使う」側の分岐へ戻る。
  ok := true; reason := null; reward_title := v_title;
  return next;
end;
$function$;