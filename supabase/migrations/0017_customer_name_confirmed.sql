-- 0017 — customers に name_confirmed_at を追加（顧客の表示名 初回確定フラグ）
--
-- 目的:
--   LINE名の自動取り込み（callback）とは別に「本人が表示名を確定したか」を持つ。
--   ・name_confirmed_at IS NULL = 未確定 → 初回チェックイン直前に /onboarding/name で入力を促す。
--   ・確定時に now() をセット。以後はゲートを通さず、callback の display_name 上書きも抑止する。
--   既存行は NULL のまま＝全員1回だけプロンプトに通す（方針①・バックフィルしない）。
--
-- 方針（0009 / 0013 と同じ作法・CLAUDE.md §3）:
--   ・add column if not exists で冪等に。既存行は非破壊（NULL 許容）。
--   ・書き込みは service_role のみ（@/lib/supabase-admin 経由）。RLS 変更なし。
--   ・適用は Supabase SQLエディタで手動。db push は使わない。

alter table public.customers
  add column if not exists name_confirmed_at timestamptz;
