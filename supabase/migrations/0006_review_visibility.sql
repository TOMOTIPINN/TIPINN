-- 0006 — reviews.visibility（店長Inboxの可視性キュレーション・画面マップ11 / Phase 5-b）
-- 準拠: CLAUDE.md §4・絶対原則 / docs/phase5b_staff_screens.md §4・§8
--
-- 目的:
--   店長が声を「全員に共有(all)」か「店長控え(manager)」かを後から選べるようにする。
--   ※ これは share_scope（＝お客様が選ぶ共有範囲の希望）とは別概念。
--     share_scope = 顧客の意思 / visibility = 店長のキュレーション判断。両者は混同しない。
--   visibility='manager' の行はスタッフ本人画面（/staff の Team voices）には出さない。
--
-- 方針:
--   ・既存行を壊さないため nullable + null許容CHECK + default 'all'。非nullの強制はしない。
--   ・RLS は deny-by-default（0001の方針）を一切変更しない。書き込みは service_role のみ。
--   ・適用はSupabase SQLエディタで手動（CLAUDE.md §3・`supabase db push` は使わない）。

alter table public.reviews
  add column if not exists visibility text not null default 'all';

alter table public.reviews
  drop constraint if exists reviews_visibility_check;
alter table public.reviews
  add  constraint reviews_visibility_check
  check (visibility in ('all','manager'));
