-- ⚠️ 適用済み（2026-09-15、SQL エディタで手動適用・関数定義を確認済み）・再実行しない
-- 0046_review_window_3days.sql
-- 感想の受付期間を「来店当日のみ」から「来店日から3日間」へ延ばす（1来店につき1感想）。
--
-- 背景:
--   スタッフからの要望。当日中に送れなかったお客様が感想を送れずに終わっていた。
--   15日に来店したら18日まで受け付ける（当日を含めて4暦日）。
--
-- 現行（0033）からの差分は **判定2か所だけ**:
--   1) 来店裏付け: 「今日(JST)の visits 行があるか」→「直近3日以内の visits の最終来店日を取る」
--   2) 既送信   : 「今日(JST)に reviews があるか」→「その最終来店日以降に reviews があるか」
--
--   ★エラー名 'no_visit_today' は **変えない**★
--     /api/reviews:98 が error.message の完全一致で 409 に変換しているため、
--     ここを変えるとアプリ側が 500 にフォールバックして文言も出なくなる。
--     意味は「受付期間内の来店が無い」に広がるが、識別子としては互換を優先する。
--
--   引数・戻り値・advisory lock・入力検証（rating / share_scope）・reviews INSERT・
--   earned_stamps の加算・security definer・search_path・revoke/grant は 0033 のまま**一切変更しない**。
--
-- 「1来店につき1感想」の意味:
--   reviews には visit_id が無いため、来店と感想を直接は結べない。
--   そこで「最終来店日以降に感想があるか」で代用する。
--   ・15日来店 → 16日に感想 → もう送れない（15日の来店ぶんは済み）
--   ・15日来店 → 16日に感想 → 17日に再来店 → 送れる（v_last_visit=17 > 16）
--   ★既知の挙動★ 15日来店 → 18日に感想 → 同じ18日に再来店した場合、
--     18日の来店ぶんは送れない（感想の日付 18 >= v_last_visit 18 で既送信と判定される）。
--     日をまたげば送れる。1来店1感想を日付だけで代用する以上ここは避けられない。

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
  -- ★受付日数★ アプリ側の REVIEW_WINDOW_DAYS（src/lib/review.ts）と一致させること。
  --   片方だけ変えると、画面は受け付けるのに RPC が弾く（またはその逆）状態になる。
  v_window_days constant integer := 3;

  v_review_id  uuid;
  v_existing   integer;
  v_count      integer;
  v_today      date;
  v_last_visit date;
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

  v_today := (now() at time zone 'Asia/Tokyo')::date;

  -- 来店裏付け（0033 を拡張）: 受付期間内の最終来店日を取る。
  --   window は [v_today - v_window_days, v_today]＝当日を含む4暦日。
  --   max() なので該当が無ければ v_last_visit は null になる（not exists の代わり）。
  select max(visited_on) into v_last_visit
  from public.visits
  where customer_id = p_customer_id
    and salon_id    = p_salon_id
    and visited_on between v_today - v_window_days and v_today;

  if v_last_visit is null then
    raise exception 'no_visit_today';
  end if;

  -- 既送信（0020 を拡張）: 「今日」ではなく「最終来店日以降」に感想があるか。
  --   v_last_visit 当日に送ったぶんも含めるため >= で比較する。
  select count(*) into v_existing
  from public.reviews
  where customer_id = p_customer_id
    and salon_id    = p_salon_id
    and (created_at at time zone 'Asia/Tokyo')::date >= v_last_visit;

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

-- 0033 と同一（create or replace では権限は保持されるが、明示して差分を残さない）。
revoke all on function
  public.submit_review_and_earn_stamp(uuid, uuid, uuid, text, integer, text[], text)
  from public;
grant execute on function
  public.submit_review_and_earn_stamp(uuid, uuid, uuid, text, integer, text[], text)
  to service_role;


-- =========================================================
-- 適用後の確認クエリ（SQL エディタで実行して目視すること）
--
--   -- 本体に window 判定が入ったか（v_window_days と between が居ること）
--   select prosrc from pg_proc where proname = 'submit_review_and_earn_stamp';
--
--   -- 受付期間内に来店がある (顧客,サロン) の件数（今この瞬間に感想を送れる母集団）
--   select count(*) from (
--     select customer_id, salon_id, max(visited_on) as last_visit
--       from public.visits
--      where visited_on between (now() at time zone 'Asia/Tokyo')::date - 3
--                           and (now() at time zone 'Asia/Tokyo')::date
--      group by 1,2
--   ) t;
-- =========================================================
