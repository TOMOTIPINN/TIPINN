-- ⚠️ 適用済み（2026-09-15、SQL エディタで手動適用・pg_indexes で WHERE (review_id IS NOT NULL) 付きの作成と既存21行 null のままを確認済み）・再実行しない
-- 0047_rating_purchases_review_id_uniq.sql
-- 1感想につき有料スタンプは1回まで（docs/40_decisions.md §13 決定4）。
--
-- 目的:
--   有料スタンプを常に「声＋評価」の組にする（§13 決定3）。同じ感想に何度も課金できると、
--   評価として不明快になり、チップ（言葉のない送金）に近づく。
--   reviews に visit_id が無いのと同様、rating_purchases 側にも「1対1」を保証する仕組みが
--   無かったため、DB の制約として置く。
--   ★アプリ側の /api/checkout にも「購入済み」チェックを置く予定だが、それは belt にすぎない★
--     Session 作成から webhook 到着までの数秒間に2回支払われると両方ともチェックを通過する。
--     **真の砦はこのインデックス**。
--
-- 前提（2026-09-15 本番確認）:
--   ・review_id は null 21件 / not null 0件。**重複なし**＝このインデックスは既存行と衝突しない。
--   ・rating_purchases の既存制約は stripe_payment_id の UNIQUE と、
--     review_id の FK（reviews(id) ON DELETE SET NULL）のみ。
--   ・部分インデックス（where review_id is not null）にするのは、
--     感想に紐付かない過去21件（全件 null）をそのまま残すため（§13 決定6・遡及しない）。
--     NULL は複数行あってよい。
--
-- webhook 側の対応（commit 66c9063・先行してデプロイ済み）:
--   src/app/api/stripe/webhook/connect/route.ts の isDuplicateReviewPurchase() が、
--   PostgREST の error.message に含まれる **このインデックス名**を照合して二重決済を検知する。
--   ★インデックス名は route.ts の定数 REVIEW_ID_UNIQUE_INDEX と完全一致させること★
--   一致していないと、違反時に throw → Stripe が再送し続け、processed_at が永久に打たれない
--   （再送ループ）。名前を変えるときは必ず両方を同時に変える。
--
--   検知時の挙動（§13 決定5・案Y）: 記録は作らず、運営者へ LINE 通知して 200 で確定する。
--   自動返金もロックもしない。運営者が Stripe で手動返金する
--   （Direct Charge のため返金元はサロンの連結アカウント）。
--
-- concurrently は使わない:
--   Supabase の SQL エディタはステートメントをトランザクション内で実行するため
--   create index concurrently が使えない。対象は21行で、ロック時間は無視できる。

create unique index if not exists rating_purchases_review_id_uniq
  on public.rating_purchases (review_id)
  where review_id is not null;


-- =========================================================
-- 適用後の確認クエリ（SQL エディタで実行して目視すること）
--
--   -- インデックスが作られたか（indexdef に WHERE 句が入っていること）
--   select indexname, indexdef from pg_indexes
--    where schemaname='public' and tablename='rating_purchases'
--      and indexname='rating_purchases_review_id_uniq';
--
--   -- 既存行が無傷か（21件のまま・review_id は全件 null）
--   select count(*) filter (where review_id is null)     as review_id_null,
--          count(*) filter (where review_id is not null) as review_id_not_null,
--          count(*) as total
--     from public.rating_purchases;
-- =========================================================
