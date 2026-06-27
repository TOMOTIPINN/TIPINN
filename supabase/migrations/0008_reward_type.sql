-- 0008 — rewards.reward_type（VIP特典の「型」・店舗別カスタムの土台 / Phase 6-A）
-- 準拠: CLAUDE.md §2 絶対原則 / §4 データモデル / echo_erd.md
--
-- 目的:
--   貯まるスタンプのVIP特典を salon ごとにカスタムできるよう、特典に「型」を持たせる。
--   型は 'discount'(割引) / 'service'(サービス・役務) / 'priority'(優先) の3値に限定。
--   特典の具体内容は既存の title（自由テキスト）に書く。発動個数も既存 required_count を使う。
--
-- 特典の付与モデル（Phase 6-A で確定）:
--   ・サロンが設定できる特典(rewards)は **最大2件**。VIPサイクル到達(3個)で2件まとめてセット付与。
--   ・はしご型(3個でA・6個でB…)はやらない＝rewards は全行 同じ required_count で並ぶ前提。
--   ・「最大2件」「同一 required_count」の強制は **アプリ側(作成API/管理画面)で担保**する。
--     ここ(DB)では型(reward_type)の値域のみを制約する（運用の柔軟性のため件数はDBで縛らない）。
--   ・VIPバッジ(echo標準・全サロン共通・1個)は rewards とは別物。後続ステップで実装。
--
-- 設計上の死守（CLAUDE.md §2）:
--   ・金額/割引率/value のような「金銭・換金性」フィールドは持たせない（意図的に不在）。
--     VIP特典は店舗が客に渡す割引/役務であって金銭還元ではない、という整理を構造で担保。
--   ・rewards は無償スタンプ側。rating_purchases（有償）とは無関係・統合しない。
--
-- 方針（0006 と同じ作法）:
--   ・既存行を壊さないため not null + default 'service'（既存の特典は「サービス」とみなす）。
--   ・RLS は deny-by-default（0001）を変更しない。書き込みは service_role のみ。
--   ・適用は Supabase SQLエディタで手動（CLAUDE.md §3・`supabase db push` は使わない）。

alter table public.rewards
  add column if not exists reward_type text not null default 'service';

alter table public.rewards
  drop constraint if exists rewards_reward_type_check;
alter table public.rewards
  add  constraint rewards_reward_type_check
  check (reward_type in ('discount', 'service', 'priority'));
