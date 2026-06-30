-- 0010_salon_logo_transform.sql
-- サロンロゴの位置調整・ズームを保存する列を salons に追加する。
--
-- 値はサイズ非依存な単位で持つ（mypage 見出し40px / スタンプドット小 / 編集88px の
-- すべてで同じ見た目になるように）:
--   logo_pos_x / logo_pos_y … 円の幅に対する移動量（％）。CSS translate(%) で適用。
--   logo_zoom              … 拡大倍率。CSS scale() で適用。
-- 既定値 (0, 0, 1) は無調整＝現状の object-fit:cover 表示と完全一致するため、
-- 既存サロンの見た目は変わらない（後方互換）。
--
-- 適用は Supabase SQL Editor で手動（CLAUDE.md §3：db push は使わない）。
-- 列追加は add column if not exists、制約は drop if exists → add で冪等に。

alter table public.salons
  add column if not exists logo_pos_x real not null default 0,
  add column if not exists logo_pos_y real not null default 0,
  add column if not exists logo_zoom  real not null default 1;

-- 値域を固定（壊れた表示・越境値を防ぐ）。x/y: -50..50(%) ／ zoom: 1..3
alter table public.salons drop constraint if exists salons_logo_pos_x_check;
alter table public.salons drop constraint if exists salons_logo_pos_y_check;
alter table public.salons drop constraint if exists salons_logo_zoom_check;

alter table public.salons
  add constraint salons_logo_pos_x_check check (logo_pos_x between -50 and 50),
  add constraint salons_logo_pos_y_check check (logo_pos_y between -50 and 50),
  add constraint salons_logo_zoom_check  check (logo_zoom  between 1 and 3);
