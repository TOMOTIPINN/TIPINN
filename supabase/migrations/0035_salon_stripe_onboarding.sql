-- 0035_salon_stripe_onboarding.sql
-- 本番適用済み（Supabase SQL Editor で手動適用済み）。事後記録。
-- ⚠️このファイルを再実行しないこと。add column は既に存在するためエラーになる。
--   原則「適用済みは再実行しない」に従う。適用は常に SQL Editor で手動。
alter table public.salons
  add column stripe_details_submitted boolean not null default false,
  add column stripe_charges_enabled   boolean not null default false,
  add column stripe_payouts_enabled   boolean not null default false,
  add column stripe_connected_at      timestamptz;

-- 既存の連携済みサロン（テストサロン）を実態に合わせる
update public.salons
set stripe_details_submitted = true,
    stripe_charges_enabled   = true,
    stripe_payouts_enabled   = true,
    stripe_connected_at      = now()
where stripe_account_id is not null;
