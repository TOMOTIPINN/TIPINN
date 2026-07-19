-- 本番適用済み（Supabase SQL Editor で手動適用済み）。事後記録。
-- ⚠️ このファイルを再実行しないこと。本番には既に存在する（create table if not exists のため
--   再実行しても無害だが、原則「適用済みは再実行しない」に従う。適用は常に SQL Editor で手動）。
-- 目的: Stripe webhook の冪等化（イベント単位の受信記録）。
--   webhook（api/stripe/webhook）が署名検証直後に (id, type, payload) を INSERT し、
--   processed_at で「処理済み」を印す。二重配信での二重課金・二重消込を最上位で止める。
-- RLS: deny-by-default（ポリシー0本＝完全deny）。読み書きは service_role（supabaseAdmin）のみ。
--   ※ public への create table 時点で ensure_rls（0031）が RLS を自動 enable するため、
--     下の enable row level security は明示・冪等の念押し。

create table if not exists public.stripe_events (
  id            text primary key,
  type          text not null,
  salon_id      uuid,
  payload       jsonb not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz
);

create index if not exists idx_stripe_events_type
  on public.stripe_events (type);

create index if not exists idx_stripe_events_unprocessed
  on public.stripe_events (received_at) where processed_at is null;

alter table public.stripe_events enable row level security;
