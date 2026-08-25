-- ⚠️ 本番適用済み（2026-08-25・SQL Editor 手動）・再実行しない
-- 適用後の確認済み: notification_outbox.attempt_count（integer / NOT NULL / default 0・
-- 既存49行はすべて 0）／ skip_reason の CHECK に invalid_user_id が入っていること。
-- 0044_outbox_attempt_count.sql
-- cron の送信ゲート反転（profile 事前確認方式）に伴う2点の追加。
--
-- 背景:
--   これまで cron は DB の customers.line_is_friend を見て送信可否を決めていた。
--   このフラグは follow webhook でしか更新されず、follow がログインより先に来た顧客は
--   false のまま取り残される（実測で nun の22人が該当。LINE 上は友だちなのに DB は false）。
--   → 送信の可否は毎回 LINE に問い合わせる（GET /v2/bot/profile/{userId}）方式に変える。
--     line_is_friend は「UI（AddFriendCard）用のキャッシュ」に降格し、判定には使わない。
--
-- 1) attempt_count — 一時エラー（429 / 5xx / ネットワーク断）を pending のまま再試行するための試行回数。
-- 2) skip_reason に 'invalid_user_id' を追加 — 実在しない ID（demo: 合成IDなど）を
--    not_friend でも failed でもなく専用理由で閉じる。永久に再試行しても無意味なため。
--
-- 既存データへの影響:
--   attempt_count は default 0 で既存行にも入る（NOT NULL 化しても既存行は 0 で埋まる）。
--   skip_reason の CHECK は「値の集合を1つ増やす」だけなので、既存値はすべて通り続ける。

-- 1) 試行回数 ---------------------------------------------------------------
alter table public.notification_outbox
  add column if not exists attempt_count integer not null default 0;

-- 上限に達したかの判定は cron 側（MAX_ATTEMPTS）で行うが、負値・異常値は DB でも弾く。
alter table public.notification_outbox
  drop constraint if exists notification_outbox_attempt_count_check;
alter table public.notification_outbox
  add  constraint notification_outbox_attempt_count_check
  check (attempt_count >= 0);

-- 2) skip_reason に 'invalid_user_id' を追加 --------------------------------
--    0024 の定義に1値足すだけ。既存の4値はそのまま残す（過去行を壊さない）。
--    'invalid_user_id' … profile 取得が 400（ID の形式不正・実在しない ID）。再試行しない。
alter table public.notification_outbox
  drop constraint if exists notification_outbox_skip_reason_check;
alter table public.notification_outbox
  add  constraint notification_outbox_skip_reason_check
  check (
    skip_reason is null
    or skip_reason in (
      'already_completed',
      'stale',
      'not_friend',
      'no_line_user',
      'invalid_user_id'
    )
  );

-- 列を追加したので PostgREST のスキーマキャッシュをリロード（§3・0024 と同じ）。
notify pgrst, 'reload schema';


-- =========================================================
-- 適用後の確認クエリ（SQL エディタで実行して目視すること）
--
--   -- 列が入ったか
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema='public' and table_name='notification_outbox'
--      and column_name='attempt_count';
--
--   -- CHECK が5値になったか
--   select pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid='public.notification_outbox'::regclass
--      and conname='notification_outbox_skip_reason_check';
--
--   -- 既存行が全部 0 で埋まったか
--   select attempt_count, count(*) from public.notification_outbox group by 1 order by 1;
-- =========================================================
