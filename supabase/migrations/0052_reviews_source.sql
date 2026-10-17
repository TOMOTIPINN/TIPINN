-- ⚠️ 本番適用済み（2026-10-17・SQLエディタで手動適用・確認済み）・再実行しない
--    適用後の確認（同日・読み取りのみ）: information_schema.columns で source | text | YES | NULL（1行）。
--    REST で reviews を select=id,source&limit=1 で読み、エラーにならないことを確認。
--
-- 0052_reviews_source.sql
-- reviews.source — 感想の流入元（'line' / 'mypage' / null）。集計専用・画面には出さない。
--
-- 経緯:
--   LINE の感想リマインドが感想につながっているかを測るため。0052 以前は流入元を区別できなかった
--   （/review の URL は LINE も /mypage も同じ `/review?salon=` だった）。
--
-- 方針（案B・2026-10-17 決定）:
--   ・列を足すだけ。submit_review_and_earn_stamp は**変更しない**（signature を変えると drop→create が要り、
--     40_decisions §1.1 / §1.2 の事故を繰り返すため）。値は /api/reviews が RPC 成功後に別途 update する。
--   ・CHECK は付けない（text・null 可）。値の検査は @/lib/review の normalizeReviewSource のみ。
--   ・既存行は null のまま（0052 以前＝流入元不明）。
--
-- 適用前の本番確認（2026-10-17・原が SQL エディタで実施・読み取りのみ）:
--   ・submit_review_and_earn_stamp は1つだけ（p_customer_id uuid, p_salon_id uuid, p_staff_id uuid,
--     p_body text, p_rating integer, p_tags text[], p_share_scope text）
--   ・INSERT は列名指定（customer_id, salon_id, staff_id, body, rating, tags, share_scope）＝列追加で壊れない
--   ・SECURITY DEFINER・search_path=public・execute は postgres と service_role のみ
--   ・reviews のトリガー 0件
--
-- 適用は Supabase SQL エディタで手動（db push は使わない）。適用・確認してからコードを push する（§1.3）。

alter table public.reviews
  add column if not exists source text;

comment on column public.reviews.source is
  '感想の流入元。line=LINEリマインド / mypage=マイページの導線 / null=それ以外・不明（店頭QR・直打ち・本列追加前）。画面には出さない。';

notify pgrst, 'reload schema';

-- 確認（結果セットで返す・§1.12）。期待値: source | text | YES | null
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'reviews' and column_name = 'source';
