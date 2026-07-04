-- 0014 — 来店後の感想リマインド通知 outbox（通知基盤スライス3）
-- 準拠: CLAUDE.md §3（migration は SQLエディタで手動適用・db push は使わない）/ §4 RLS deny-by-default
--       §2 原則5/6（来店軸は無料・無決済・¥非連動）/ 0009（visit RPC の advisory lock + JST判定を流用）
--
-- 目的:
--   来店記録（submit_visit_and_earn_stamp の初回来店）と原子的に、
--   「来店時刻 + salons.notify_after_minutes 後に感想リマインドを送る」1行を outbox に積む。
--   実際の push は Vercel cron（/api/cron/line-push）が notify_at 到達後に拾って送る。
--
-- 設計判断（確定事項）:
--   ・enqueue は RPC 内で原子的（visits INSERT と同一トランザクション）。stamp_awarded=true の初回だけ。
--   ・notify_after_minutes 既定 180分（30〜360）。サロン単位で可変。
--   ・鮮度優先: friend=false / notify_at が古い(cron側で+24h超) は送らず 'skipped' にする（cron側ロジック）。
--   ・1日1重複防止は unique(customer_id, salon_id, visited_on, kind)。awarded=true が既に1日1回だが二重防御。
--   ・RLS deny-by-default。ポリシー無し＝service_role のみ（cron/RPC は supabaseAdmin 経由）。
--   ・適用は Supabase SQLエディタで手動。

-- =========================================================
-- 1) salons に通知遅延分を追加（サロン単位・既定180分）
-- =========================================================
alter table public.salons
  add column if not exists notify_after_minutes integer not null default 180;

alter table public.salons
  drop constraint if exists salons_notify_after_minutes_check;
alter table public.salons
  add  constraint salons_notify_after_minutes_check
  check (notify_after_minutes between 30 and 360);

-- =========================================================
-- 2) notification_outbox（送信予約の台帳 / 冪等・状態機械）
--    status: pending → sent / skipped / failed（cron が遷移させる）。
--    visited_on は JST(Asia/Tokyo) の来店暦日。1日1重複を unique で担保。
-- =========================================================
create table if not exists public.notification_outbox (
  id          uuid        not null default gen_random_uuid() primary key,
  customer_id uuid        not null references public.customers(id) on delete cascade,
  salon_id    uuid        not null references public.salons(id)    on delete cascade,
  kind        text        not null default 'visit_review_request',
  visited_on  date        not null,                    -- JST の来店日（重複判定キー）
  notify_at   timestamptz not null,                    -- 送信予定時刻（来店時刻 + notify_after_minutes）
  status      text        not null default 'pending',
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  constraint notification_outbox_kind_check
    check (kind in ('visit_review_request')),
  constraint notification_outbox_status_check
    check (status in ('pending', 'sent', 'skipped', 'failed')),
  unique (customer_id, salon_id, visited_on, kind)
);

-- cron の拾い上げ（status=pending かつ notify_at<=now）を効かせる部分索引。
create index if not exists idx_outbox_pending_due
  on public.notification_outbox (notify_at)
  where status = 'pending';

-- RLS: deny-by-default（0001方針）。ポリシーを作らない＝anon/authenticated 遮断・service_role のみ。
alter table public.notification_outbox enable row level security;

-- =========================================================
-- 3) submit_visit_and_earn_stamp を再定義（0009 と同型 ＋ 原子的 enqueue）
--    初回来店(stamp_awarded=true)のときだけ outbox に1行積む。戻り値は 0009 と同じ。
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
  v_after   integer;
begin
  -- 同一 (顧客, サロン) の同時アクセスを直列化し、1日1回ルールの競合を防ぐ（0009と同じ）。
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

  -- 初回来店のときだけ、感想リマインドを outbox に予約（原子的）。
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
