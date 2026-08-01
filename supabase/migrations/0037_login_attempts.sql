-- ⚠️ 本番適用済み（2026-08-01）・再実行しない
-- 0037_login_attempts.sql
-- 認証試行の記録とレート制限の基盤
-- 割賦販売法セキュリティ・チェックリスト 1-3 / 6 に対応

create table if not exists public.login_attempts (
  id            bigserial primary key,
  scope         text        not null,
  ip            inet,
  succeeded     boolean     not null,
  detail        text,
  created_at    timestamptz not null default now()
);

create index if not exists login_attempts_scope_ip_created_idx
  on public.login_attempts (scope, ip, created_at desc);

create index if not exists login_attempts_created_idx
  on public.login_attempts (created_at);

-- RLS: ポリシーを1本も定義しない＝完全 deny（意図的）
-- 認証試行ログは service_role からのみ読み書きする。
-- 管理画面から閲覧させる導線は現時点で作らない。
-- 将来必要になった場合は security definer RPC 経由とし、
-- 直接 SELECT を許すポリシーは追加しない。
alter table public.login_attempts enable row level security;
