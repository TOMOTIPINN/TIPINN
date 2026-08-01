-- ⚠️ 本番適用済み（2026-08-01）・再実行しない
-- 呼び出し側は未実装（cron 未設定）。30日保存は現時点で効いていない。
-- 0038_purge_login_attempts.sql
-- login_attempts の保存期間を30日に制限する

create or replace function public.purge_old_login_attempts()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.login_attempts
  where created_at < now() - interval '30 days';
$$;

revoke all on function public.purge_old_login_attempts() from public, anon, authenticated;
