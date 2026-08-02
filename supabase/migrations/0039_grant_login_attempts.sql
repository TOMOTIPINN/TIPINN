-- ⚠️ 本番適用済み（2026-08-02）・再実行しない
-- 0037 で bigserial 由来の login_attempts_id_seq に service_role の USAGE が
-- 付かず、insert が 42501 permission denied for sequence で全落ちしていた。
-- RLS（ポリシー0本＝完全deny）は正しく、service_role は BYPASSRLS で抜ける。
-- 落ちていたのはその手前の GRANT 層。
grant usage, select on sequence public.login_attempts_id_seq to service_role;
grant insert, select on table public.login_attempts to service_role;
