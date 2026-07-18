-- 0011_staff_profile.sql
-- スタッフのプロフィール列を追加。
-- photo_url は 0001 で既出・role は権限列(認証B)なので触らない。
-- job_title=職種（プリセット＋自由入力hybrid・text。権限 role とは別物）/ bio=一言（上限はアプリ層で25字。DB CHECK 無し）。
-- 既存行非破壊（nullable）・冪等（if not exists）。適用は SQL Editor で手動（CLAUDE.md §3）。
alter table public.staff
  add column if not exists job_title text,
  add column if not exists bio       text;
