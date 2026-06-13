-- echo — フェーズ1 DBスキーマ（MVP）
-- 適用先: Supabase プロジェクト ztvjwfofznqndqbsnluq（東京）
-- 準拠: CLAUDE.md「1.絶対原則」「4.RLS」
--
-- 設計上の原則（コードでもDBでも崩さない）:
--   ・rating_purchases（有償）に 残高/チャージ/繰越 カラムを持たせない（原則5）
--   ・earned_stamps（無償）は count のみ・金額換算しない（原則4）
--   ・staff は評価対象であって金銭の受取人ではない → 口座/送金カラムを作らない（原則6）
--   ・賞与の自動計算ロジックはDBに持たせない（原則7）

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- 1. customers（顧客＝中央台帳。echo全体で1アカウント）
create table public.customers (
  id           uuid primary key default gen_random_uuid(),
  line_user_id text not null unique,
  display_name text not null,
  created_at   timestamptz not null default now()
);

-- 2. salons（サロン）
create table public.salons (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  logo_url          text,
  stripe_account_id text unique,        -- 連結アカウントID
  created_at        timestamptz not null default now()
);

-- 3. staff（スタッフ＝評価対象。受取人ではない／口座カラムは持たせない）
create table public.staff (
  id         uuid primary key default gen_random_uuid(),
  salon_id   uuid not null references public.salons(id) on delete cascade,
  name       text not null,
  photo_url  text,
  created_at timestamptz not null default now()
);

-- 4. reviews（感想＝無償）
create table public.reviews (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  salon_id    uuid not null references public.salons(id)    on delete cascade,
  staff_id    uuid          references public.staff(id)     on delete set null,
  body        text not null,
  created_at  timestamptz not null default now()
);

-- 5. rating_purchases（評価スタンプ＝有償・買い切りの記録のみ）
create table public.rating_purchases (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid not null references public.customers(id) on delete restrict,
  salon_id          uuid not null references public.salons(id)    on delete restrict,
  staff_id          uuid          references public.staff(id)     on delete set null,
  review_id         uuid          references public.reviews(id)   on delete set null, -- 0 or 1
  tier              text    not null check (tier in
                      ('thank_you','grateful','wonderful','amazing','unforgettable')),
  amount            integer not null check (amount in (100,300,500,1000,10000)), -- 記録用。残高ではない
  stripe_payment_id text unique,
  created_at        timestamptz not null default now()
  -- ※ 残高・チャージ・繰越カラムは持たせない（絶対原則5）
);

-- 6. earned_stamps（貯まるスタンプ＝無償・count のみ・金額換算しない）
create table public.earned_stamps (
  id          uuid    not null default gen_random_uuid() primary key,
  customer_id uuid    not null references public.customers(id) on delete cascade,
  salon_id    uuid    not null references public.salons(id)    on delete cascade,
  count       integer not null default 0 check (count >= 0),
  updated_at  timestamptz not null default now(),
  unique (customer_id, salon_id)
);

-- 7. rewards（特典）
create table public.rewards (
  id             uuid primary key default gen_random_uuid(),
  salon_id       uuid    not null references public.salons(id) on delete cascade,
  required_count integer not null check (required_count > 0),
  title          text    not null,
  created_at     timestamptz not null default now()
);

-- マルチテナントの起点は salon_id → スコープ用インデックス
create index idx_staff_salon            on public.staff(salon_id);
create index idx_reviews_salon          on public.reviews(salon_id);
create index idx_reviews_customer       on public.reviews(customer_id);
create index idx_rating_purchases_salon on public.rating_purchases(salon_id);
create index idx_rating_purchases_cust  on public.rating_purchases(customer_id);
create index idx_earned_stamps_salon    on public.earned_stamps(salon_id);
create index idx_rewards_salon          on public.rewards(salon_id);

-- =========================================================
-- RLS（行レベルセキュリティ）— 全テーブルで有効化（原則8）
-- =========================================================
alter table public.customers        enable row level security;
alter table public.salons           enable row level security;
alter table public.staff            enable row level security;
alter table public.reviews          enable row level security;
alter table public.rating_purchases enable row level security;
alter table public.earned_stamps    enable row level security;
alter table public.rewards          enable row level security;

-- フェーズ1の方針: ポリシーを「作らない」= deny-by-default。
--   ・publishable(anon)/authenticated ロールからは全テーブル遮断
--   ・SUPABASE_SECRET_KEY（service_role）のみ RLS をバイパスして全体参照
-- 顧客向け(自分のcustomer_idのみ) / サロン向け(自店salon_idのみ・customersの
-- 個人情報は非参照)の具体ポリシーは、LINEログイン→Supabase JWTのクレーム設計
-- (例: auth.jwt()->>'customer_id' / 'salon_id') が固まってから 0002 で追加する。
