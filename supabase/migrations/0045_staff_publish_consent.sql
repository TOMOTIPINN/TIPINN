-- ⚠️ 適用済み（2026-09-15、SQL エディタで手動適用・列と FK を確認済み）・再実行しない
-- 0045_staff_publish_consent.sql
-- スタッフのプロフィール公開について「店長が本人に説明し、同意を得た」ことの記録。
--
-- 背景（docs/40_decisions.md §9 と同型の「気づけない穴」）:
--   staff 行は店長が追加した瞬間に作られ、archived_at is null なので
--   その時点から /api/staff の絞り込みを通過して顧客に氏名が表示される。
--   本人の LINE 紐付けも、本人が画面に到達することも不要＝本人が知らないまま公開され得る。
--   そこで「追加する店長が、本人への説明と同意取得を確認した」ことを行に残す。
--
-- ★この2列は公開可否を制御しない（意図的）★
--   顧客側の表示条件は従来どおり salon_id 一致 ＋ archived_at is null のみ。
--   ここを公開ゲートにすると、既存の全スタッフ（confirmed_at が null）が
--   一斉に非表示になり、稼働中のサロンの感想フォームからスタッフが消える。
--   この列は**記録**であって**制御**ではない。制御に使いたくなったら、
--   既存行の扱いを決めてから別 migration で行うこと。
--
-- 既存データへの影響:
--   両列とも NULL 許容で default なし＝既存49行は NULL のまま。
--   NULL の意味は「同意を確認した記録がない」であり「同意していない」ではない
--   （この仕組みより前に追加されたスタッフが該当する）。

-- 1) 確認日時 ---------------------------------------------------------------
--    NULL = 記録なし。値が入っていれば「その時刻に店長が確認した」。
--    NOT NULL 化しない（既存行に嘘の日時を入れないため）。
alter table public.staff
  add column if not exists publish_consent_confirmed_at timestamptz;

-- 2) 確認した店長 -----------------------------------------------------------
--    誰が確認したかを残す。staff(id) への自己参照 FK。
--    on delete set null: 確認した店長が後で削除されても、
--    確認が行われた事実（confirmed_at）まで巻き添えで消さない。
alter table public.staff
  add column if not exists publish_consent_confirmed_by uuid
  references public.staff(id) on delete set null;

-- 列を追加したので PostgREST のスキーマキャッシュをリロード（§3・0024 / 0044 と同じ）。
notify pgrst, 'reload schema';


-- =========================================================
-- 適用後の確認クエリ（SQL エディタで実行して目視すること）
--
--   -- 2列が入ったか（型・NULL 許容・default なし）
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema='public' and table_name='staff'
--      and column_name in ('publish_consent_confirmed_at','publish_consent_confirmed_by')
--    order by column_name;
--
--   -- FK が staff(id) を指し、on delete set null になっているか
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid='public.staff'::regclass
--      and contype='f'
--      and pg_get_constraintdef(oid) like '%publish_consent_confirmed_by%';
--
--   -- 既存行が全部 NULL のままか（この migration は既存行を書き換えない）
--   select count(*) filter (where publish_consent_confirmed_at is null) as 記録なし,
--          count(*) filter (where publish_consent_confirmed_at is not null) as 記録あり
--     from public.staff;
-- =========================================================
