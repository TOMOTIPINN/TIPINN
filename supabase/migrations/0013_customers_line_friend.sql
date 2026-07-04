-- 0013 — customers に LINE friend 状態を追加（通知基盤スライス2）
-- 準拠: CLAUDE.md §3（migration は SQLエディタで手動適用・db push は使わない）/ §4 RLS deny-by-default
--
-- 目的:
--   Messaging API の follow/unfollow webhook（/api/line/webhook）で friend 状態を記録するための列。
--   ・follow  → line_is_friend = true
--   ・unfollow → line_is_friend = false
--   デフォルト false（未フォロー扱い）。既存行は false で埋まる。
--
-- 方針（0009 と同じ作法）:
--   ・add column if not exists で冪等に。
--   ・書き込みは service_role のみ（webhook は @/lib/supabase-admin 経由）。RLS 変更なし。
--   ・適用は Supabase SQLエディタで手動。

alter table public.customers
  add column if not exists line_is_friend boolean not null default false;
