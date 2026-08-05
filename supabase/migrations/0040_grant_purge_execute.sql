-- ⚠️ 本番適用済み（2026-08-05）・再実行しない
-- 0038 で revoke all ... from public, anon, authenticated した際、
-- service_role の EXECUTE も外れており、cron から呼べない状態だった。
-- security definer なので関数の中身は postgres 権限で動くが、呼び出し自体が 42501 で弾かれる。
-- 0039（login_attempts_id_seq の GRANT 欠落）と同じ構図。
grant execute on function public.purge_old_login_attempts() to service_role;
