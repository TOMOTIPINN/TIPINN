-- 本番適用済み（Supabase SQL Editor で手動適用済み）。事後記録。
-- ⚠️ このファイルを再実行しないこと。本番には既に存在する（create table if not exists /
--   create or replace function / drop trigger if exists のため再実行しても無害だが、
--   原則「適用済みは再実行しない」に従う。適用は常に SQL Editor で手動）。

-- 0034_audit_log.sql
-- スタンプ・特典・消込に関わる変更を追記専用で記録する。
--
-- 目的（既存の内蔵列に対して、これが足すもの）:
--   1. DELETE の保全  … 行が消えると redeemed_by 等も消える。ここには残る。
--   2. UPDATE の履歴  … 内蔵列は「最新の状態」しか持たない。変更の経緯が残る。
--   3. 一箇所に集約  … 顧客からの問い合わせ時に、テーブルを横断せず追える。
--
-- ※ アプリ側のコード変更は不要（トリガーで自動記録）。

------------------------------------------------------------------------
-- 1) 監査ログ本体（追記専用）
------------------------------------------------------------------------
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  salon_id    uuid,
  customer_id uuid,          -- 「この顧客に何が起きたか」を辿るための列
  actor_type  text,
  actor_id    text,
  action      text not null, -- INSERT / UPDATE / DELETE
  table_name  text not null,
  record_id   text,
  old_data    jsonb,         -- 変更前（UPDATE / DELETE 時）
  new_data    jsonb,         -- 変更後（INSERT / UPDATE 時）
  created_at  timestamptz not null default now()
);

-- サロン単位の時系列閲覧
create index if not exists idx_audit_log_salon
  on public.audit_log (salon_id, created_at desc);

-- 顧客からの問い合わせ対応（最頻用途）
create index if not exists idx_audit_log_customer
  on public.audit_log (customer_id, created_at desc);

-- 「このレコードの履歴」を追う
create index if not exists idx_audit_log_record
  on public.audit_log (table_name, record_id, created_at desc);

------------------------------------------------------------------------
-- 2) 共通トリガー関数
--    どの経路から更新されても必ず記録される（＝書き漏らしが起きない）。
------------------------------------------------------------------------
create or replace function public.fn_audit_log()
returns trigger
language plpgsql
security definer                 -- audit_log への書き込みが RLS に阻まれないため
set search_path = public
as $$
declare
  v_actor_id    text;
  v_actor_type  text;
  v_claims      jsonb;
  v_row         jsonb;
  v_salon_id    uuid;
  v_customer_id uuid;
  v_record_id   text;
begin
  -- (1) アプリが明示的に渡した値を最優先（RPC 内で set_config した場合）
  v_actor_id   := nullif(current_setting('app.current_user_id',    true), '');
  v_actor_type := nullif(current_setting('app.current_actor_type', true), '');

  -- (2) 無ければ PostgREST が注入する JWT クレームから取得
  --     ※ echo は現状ほぼ service_role 経由のため、多くの場合 null になる。
  --        「誰が」は new_data 内の redeemed_by / created_by 等で辿れる。
  if v_actor_id is null then
    begin
      v_claims     := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
      v_actor_id   := v_claims ->> 'sub';
      v_actor_type := coalesce(v_actor_type, v_claims ->> 'role');
    exception when others then
      v_actor_id := null;
    end;
  end if;

  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;

  -- 列の有無に依存しないよう jsonb 経由で取り出す
  v_salon_id    := nullif(v_row ->> 'salon_id',    '')::uuid;
  v_customer_id := nullif(v_row ->> 'customer_id', '')::uuid;
  v_record_id   := v_row ->> 'id';

  insert into public.audit_log(
    salon_id, customer_id, actor_type, actor_id,
    action, table_name, record_id, old_data, new_data
  ) values (
    v_salon_id,
    v_customer_id,
    coalesce(v_actor_type, 'service'),
    v_actor_id,
    tg_op,
    tg_table_name,
    v_record_id,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

------------------------------------------------------------------------
-- 3) 対象テーブルへの付与
--    スタンプ・特典・消込の4テーブル。
--    rating_purchases は Stripe webhook が作るのみで書き換え想定がなく、
--    件数も多いため対象外とする。
------------------------------------------------------------------------

-- スタンプ数の本体（可変カウンタ。問い合わせで最も参照する）
drop trigger if exists trg_audit_earned_stamps on public.earned_stamps;
create trigger trg_audit_earned_stamps
  after insert or update or delete on public.earned_stamps
  for each row execute function public.fn_audit_log();

-- サロンが設定する特典
drop trigger if exists trg_audit_rewards on public.rewards;
create trigger trg_audit_rewards
  after insert or update or delete on public.rewards
  for each row execute function public.fn_audit_log();

-- 消込・取消
drop trigger if exists trg_audit_reward_redemptions on public.reward_redemptions;
create trigger trg_audit_reward_redemptions
  after insert or update or delete on public.reward_redemptions
  for each row execute function public.fn_audit_log();

-- スタンプの手動調整（最もセンシティブな操作）
drop trigger if exists trg_audit_stamp_adjustments on public.stamp_adjustments;
create trigger trg_audit_stamp_adjustments
  after insert or update or delete on public.stamp_adjustments
  for each row execute function public.fn_audit_log();

------------------------------------------------------------------------
-- 4) 監査ログ自身は追記専用。
--    RLS 有効 + ポリシー0件（deny-by-default）で通常ロールを完全遮断。
--    トリガーは security definer、閲覧は service_role 経由なので RLS 下でも機能する。
------------------------------------------------------------------------
alter table public.audit_log enable row level security;
