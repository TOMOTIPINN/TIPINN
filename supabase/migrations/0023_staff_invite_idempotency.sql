-- 0023 — スタッフ招待作成の二重送信防止（client 生成の idempotency_key）
-- 準拠: CLAUDE.md §3（マイグレーションは Supabase SQL エディタで手動適用・`supabase db push` は使わない）
--
-- 背景:
--   /manager/staff の追加フォームはネイティブ HTML form POST（クライアントJSなし）だったため、
--   ボタンの二度押し / Enter 連打で redirect 完了前に2回 POST が飛び、staff が重複作成された。
--   （実例: CARTA「たくま」が 3 秒差で2件・2026-07-12。写真なしの新しい方を手動 delete。）
--
-- 恒久対策:
--   クライアントがフォームを開いた時点で uuid を1個生成して送信し、DB 側で unique 制約により
--   2回目の insert を握り潰す。API は upsert(onConflict=idempotency_key, ignoreDuplicates)
--   ＝ INSERT ... ON CONFLICT DO NOTHING で、2回目は既存行を引いて同じ結果を返す（冪等）。
--
-- index の設計（重要）:
--   ・部分 index（where idempotency_key is not null）にはしない。supabase-js の upsert は
--     `ON CONFLICT (idempotency_key) DO NOTHING`（WHERE 述語なし）を生成するため、部分 index だと
--     「matching unique constraint がない」エラーになる。フル unique index にする。
--   ・既存 staff 行は idempotency_key = NULL。PostgreSQL 既定（NULLS DISTINCT）で NULL 複数は
--     unique 衝突しないため、既存行・idempotency_key を付けない他経路（salon/new のオーナー
--     自動登録・demo/login）の insert はそのまま通る。

alter table public.staff
  add column if not exists idempotency_key uuid;

create unique index if not exists staff_idempotency_key_key
  on public.staff (idempotency_key);
