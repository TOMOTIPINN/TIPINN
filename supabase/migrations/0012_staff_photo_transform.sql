-- 0012_staff_photo_transform.sql
-- スタッフ写真の位置調整・ズームを保存する列を staff に追加（0010 のロゴ列と同形）。
--
--   photo_pos_x / photo_pos_y … 円の幅に対する移動量（％）。CSS translate(%) で適用。
--   photo_zoom              … 拡大倍率。CSS scale() で適用。
-- 既定値 (0, 0, 1) は無調整＝従来の object-fit:cover 表示と一致（後方互換）。
-- 既存行非破壊（not null + default）・冪等（if not exists / drop if exists）。
-- 適用は Supabase SQL Editor で手動（CLAUDE.md §3：db push は使わない）。

alter table public.staff
  add column if not exists photo_pos_x real not null default 0,
  add column if not exists photo_pos_y real not null default 0,
  add column if not exists photo_zoom  real not null default 1;

-- 値域を固定（壊れた表示・越境値を防ぐ）。x/y: -50..50(%) ／ zoom: 1..3
alter table public.staff drop constraint if exists staff_photo_pos_x_check;
alter table public.staff drop constraint if exists staff_photo_pos_y_check;
alter table public.staff drop constraint if exists staff_photo_zoom_check;

alter table public.staff
  add constraint staff_photo_pos_x_check check (photo_pos_x between -50 and 50),
  add constraint staff_photo_pos_y_check check (photo_pos_y between -50 and 50),
  add constraint staff_photo_zoom_check  check (photo_zoom  between 1 and 3);
