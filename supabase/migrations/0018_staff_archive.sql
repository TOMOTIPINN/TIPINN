-- 0018 — staff に archived_at を追加（スタッフの論理削除＝退職アーカイブ）
--
-- 目的:
--   退職スタッフを archived_at で論理削除する。一覧・顧客のスタッフ選択・新規評価受付から外れるが、
--   reviews.staff_id / rating_purchases.staff_id で紐付いた実績・金額台帳は行ごと残す（物理削除しない）。
--   ・archived_at IS NULL = 在籍（既定）／ NOT NULL = 退職（その時刻）。
--   ・復帰は archived_at = null に戻す。line_user_id / invite_token は触らない（復帰対応）。
--
-- 方針（0009 / 0013 / 0017 と同じ作法・CLAUDE.md §3）:
--   ・add column if not exists で冪等に。既存行は非破壊（NULL＝在籍）。
--   ・書き込みは service_role のみ（@/lib/supabase-admin 経由）。RLS 変更なし。
--   ・適用は Supabase SQLエディタで手動。db push は使わない。

alter table public.staff
  add column if not exists archived_at timestamptz;
