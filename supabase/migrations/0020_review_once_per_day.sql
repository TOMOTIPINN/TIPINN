-- 0020 — 感想の重複投稿制限（1来店＝1顧客/1サロン/JST日 につき1回）
-- 準拠: CLAUDE.md §4（RPC・1日1個ルールの単位）/ §2 / 0004 の作法（advisory lock・RPC内判定・deny-by-default）
--
-- 目的:
--   同一 (顧客, サロン, JST日) に review が既に存在する場合、2通目以降の投稿を拒否する。
--   判定単位は「貯まるスタンプ 1個/顧客/サロン/日(JST)」と完全に同一（staff は問わない
--   ＝ALL staff への送信も個別スタッフへの送信も、その日の1回としてカウント）。
--   ・拒否は例外ではなく戻り値フラグ already_submitted で返す（UI は優しい既送信状態を出す・客を責めない）。
--   ・reviews への UNIQUE 制約は張らない:
--       (created_at AT TIME ZONE 'Asia/Tokyo')::date は STABLE（IMMUTABLE でない）ため
--       関数一意インデックスにできず、既存重複行があると作成も失敗する。0004/0009/0019 と同じく
--       advisory lock + RPC 内判定で担保する（既存設計との整合）。
--   ・RLS deny-by-default（0001）は変更しない。service_role のみ実行。
--   適用: Supabase SQLエディタで手動（`supabase db push` は使わない・CLAUDE.md §3）。

-- OUT列が変わるため drop → 再作成（引数シグネチャは 0004 と同一）。
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
  -- 入力検証（DB側の最後の砦・0004 踏襲）
  if p_rating is null or p_rating < 1 or p_rating > 4 then
    raise exception 'invalid rating: %', p_rating;
  end if;
  if p_share_scope is null or p_share_scope not in ('manager_only','everyone','either') then
    raise exception 'invalid share_scope: %', p_share_scope;
  end if;

  -- 同一 (顧客, サロン) を直列化（0004/0009/0019 と同じ）。同日1回判定の競合を防ぐ。
  perform pg_advisory_xact_lock(
    hashtextextended(p_customer_id::text || ':' || p_salon_id::text, 0)
  );

  -- 既送信チェック: 今日(JST)この(顧客,サロン)に review があるか。
  -- staff は問わない＝ALL staff/個別いずれも「その日の1回」。あれば挿入せず既送信を返す。
  select count(*) into v_existing
  from public.reviews
  where customer_id = p_customer_id
    and salon_id    = p_salon_id
    and (created_at at time zone 'Asia/Tokyo')::date
        = (now()       at time zone 'Asia/Tokyo')::date;

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

  -- 本日初回: review 挿入 ＋ 感想スタンプ +1。
  -- この分岐は定義上「その日の初回」なので stamp_awarded は常に true。
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

-- deny-by-default を維持: service_role のみ実行（0004 と同一）。
revoke all on function
  public.submit_review_and_earn_stamp(uuid, uuid, uuid, text, integer, text[], text)
  from public;
grant execute on function
  public.submit_review_and_earn_stamp(uuid, uuid, uuid, text, integer, text[], text)
  to service_role;
