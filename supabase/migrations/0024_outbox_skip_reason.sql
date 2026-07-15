-- 0024 — 来店リマインド通知 outbox に skip 理由列を追加（既感想スキップの観測）
-- 準拠: CLAUDE.md §3（マイグレーションは Supabase SQL エディタで手動適用・`supabase db push` は使わない /
--       列を変えたら `notify pgrst, 'reload schema';` でスキーマキャッシュをリロード）/ 0014（outbox 本体）
--
-- 背景:
--   LINE 通知の「既感想スキップ」を入れる（cron が push 直前に、その来店日(JST)に
--   review AND rating_purchase の両方が存在する顧客への「来店ありがとう」リマインドを送らない）。
--   ただし現状の status は 'pending'/'sent'/'skipped'/'failed' の4値だけで、'skipped' が
--   「鮮度切れ / 非友だち / line_user_id 無し」を全部まとめている。新しい skip（既感想）を
--   後日「緩め」に倒すか判断するには、skip の理由を durable に区別して観測できる必要がある。
--
-- 方針（確定・案A）:
--   ・status（状態機械）は触らない。skip の「理由」を別列 skip_reason（nullable text）に持つ。
--     status='skipped' のときだけ埋め、それ以外（pending/sent/failed）は NULL。
--   ・enum は Postgres enum 型ではなく CHECK 制約。NULL 許容 ＋ 既知の理由セットに限定する。
--   ・観測は  select skip_reason, count(*) from notification_outbox
--             where status='skipped' group by skip_reason;  で内訳が取れる。
--   ・既存行（status='skipped' の1件・鮮度/非友だち由来）は skip_reason=NULL のまま残る
--     ＝「理由不明の旧 skip」。新規分から理由が埋まる（後方互換・移行バックフィル不要）。
--
-- 理由の値（cron 側の分岐に対応）:
--   'already_completed' … その来店日(JST)に review と rating_purchase が両方あり（今回の新スキップ）
--   'stale'             … notify_at が古すぎる（STALE_HOURS 超）
--   'not_friend'        … line_is_friend=false
--   'no_line_user'      … line_user_id 無し

alter table public.notification_outbox
  add column if not exists skip_reason text;

-- NULL 許容 ＋ 既知の理由セットに限定（誤値の混入を防ぐ）。
alter table public.notification_outbox
  drop constraint if exists notification_outbox_skip_reason_check;
alter table public.notification_outbox
  add  constraint notification_outbox_skip_reason_check
  check (
    skip_reason is null
    or skip_reason in ('already_completed', 'stale', 'not_friend', 'no_line_user')
  );

-- 列を追加したので PostgREST のスキーマキャッシュをリロード（§3）。
notify pgrst, 'reload schema';
