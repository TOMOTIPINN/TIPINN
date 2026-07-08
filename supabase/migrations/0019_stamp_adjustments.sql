-- 0019 — 来店スタンプ移行台帳（旧LINEショップカード引き継ぎ / stamp_adjustments）
-- 準拠: CLAUDE.md §2 絶対原則 / §4 データモデル・RLS / §8 ・ 0009（来店軸・COUNT累計方式・advisory lock）
--
-- 目的:
--   旧LINEショップカードの残高を、来店軸の累計へ「加算オフセット」として引き継ぐ。
--   累計の定義を  COUNT(visits) + COALESCE(SUM(stamp_adjustments.delta),0)  の1式に一本化する。
--   ・visits の日次イベントログ設計（0009・カウンタ列を作らない方針）を壊さない（別テーブルの加算台帳）。
--   ・冪等: 顧客×サロン×source で1回（unique）。訂正は既存行の UPDATE で対応。
--   ・migration経路は正クランプ（0〜salons.visit_cycle_size）だが、delta列自体は符号可（将来の他用途に備える）。
--
-- 権限（アプリ側で担保）:
--   ・新規入力・訂正は在籍スタッフ全員が可能（端末経路も可）。ロール判定はしない。
--   ・created_by / updated_by は「誰が入力・訂正したか」の追跡用に保持するだけ（操作は止めない）。
--     端末経路（LINE無し据え置き端末）は個人特定不可のため null。staff 退職（削除）時は set null。
--
-- 運用前提（カットオーバー規律・コードでは強制しない）:
--   ・echo の来店チェックインはカットオーバー時点から開始（それ以前の echo 来店は記録しない）。
--   ・delta はカットオーバー時点の旧カード残高。移行時 COUNT(visits)≈0 のため実来店と重複しない。
--
-- 方針（0009 と同じ作法）:
--   ・RLS deny-by-default（0001）。ポリシーを作らない＝service_role のみ。
--   ・適用は Supabase SQLエディタで手動（CLAUDE.md §3・`supabase db push` は使わない）。

-- =========================================================
-- 1) 移行台帳テーブル（加算オフセット）
--    unique(customer_id, salon_id, source) が
--    mypage 一括読み(customer_id 先頭)・単一ペア読み(customer_id,salon_id)を両方カバー。
-- =========================================================
create table if not exists public.stamp_adjustments (
  id          uuid        not null default gen_random_uuid() primary key,
  customer_id uuid        not null references public.customers(id) on delete cascade,
  salon_id    uuid        not null references public.salons(id)    on delete cascade,
  delta       integer     not null,                 -- 符号可(将来用)。migration経路は正クランプ
  source      text        not null default 'migration',
  note        text,                                  -- 任意（申告根拠・操作メモ等）
  created_by  uuid        references public.staff(id) on delete set null,  -- 入力した在籍staff。端末経路は null
  updated_by  uuid        references public.staff(id) on delete set null,  -- 直近に訂正した在籍staff。端末経路は null
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (customer_id, salon_id, source)             -- 顧客×サロン×source で1回（冪等）
);

-- =========================================================
-- 2) RLS: deny-by-default（0001方針）。ポリシー未作成＝anon/authenticated 遮断・service_role のみ。
-- =========================================================
alter table public.stamp_adjustments enable row level security;

-- =========================================================
-- 3) RPC 再定義: new_count を COUNT(visits) + SUM(delta) に変更（累計一本化のSQL側の単一ソース）。
--    stamp_awarded は不変（＝当日初回来店 INSERT の成否のみ。delta 非依存）。
--    移行の書き込みは別API（stamp_adjustments への upsert）が行い、RPC は読むだけ。
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
  v_adj     integer;
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
