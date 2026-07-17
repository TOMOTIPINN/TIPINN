-- 本番適用済み（2026-07-16〜17・SQL Editor 手動）。ファイルは事後記録。
-- ⚠️ このファイルを再実行しないこと。本番には既に存在する。

-- ============================================================
-- reward_redemptions テーブル
-- ============================================================
-- 消費型特典の消込記録。1行 = 「この顧客が、この来店で、この特典を、このサイクル分 使った」。
-- 物理削除はしない（voided_at で取消・部分unique が再消込を許す）。

create table reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  salon_id   uuid not null references salons(id)    on delete cascade,
  reward_id  uuid not null references rewards(id)   on delete restrict,
  visit_id   uuid not null references visits(id)    on delete cascade,
  cycle_axis  text not null check (cycle_axis in ('review','visit')),
  cycle_index int  not null,
  redeemed_by uuid references staff(id) on delete set null,
  redeemed_at timestamptz not null default now(),
  voided_at   timestamptz,
  voided_by   uuid references staff(id) on delete set null
);

-- 同一サイクルの同一特典は1回だけ（取消済みは除外）
CREATE UNIQUE INDEX reward_redemptions_active_uniq
  ON public.reward_redemptions USING btree (customer_id, salon_id, reward_id, cycle_axis, cycle_index)
  WHERE (voided_at IS NULL);

-- 1来店1消費（取消済みは除外）
CREATE UNIQUE INDEX reward_redemptions_one_per_visit
  ON public.reward_redemptions USING btree (visit_id)
  WHERE (voided_at IS NULL);

alter table reward_redemptions enable row level security;
-- policy は deny-by-default（ポリシー0本＝完全deny）。
-- ⚠️ RPC は security definer なので書き込みは通るが、manager 画面等から
--   redemptions を直接 select する実装にすると読めない。読む導線を作るなら select ポリシーが要る。

-- ============================================================
-- rewards.is_consumable
-- ============================================================
-- 消費型（使ったら消える・例: ご褒美SPA）/ 状態型（権利・消えない・例: VIPセール対象）の区別。
-- reward_type（discount/service/priority）とは直交する。
-- 既存行は一律 false（＝状態型・現状の挙動のまま）。店長が /manager/rewards で
-- 明示的に「1回きり」を選んだときだけ true になる。

alter table rewards add column is_consumable boolean not null default false;
