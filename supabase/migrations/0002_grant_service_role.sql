-- echo — フェーズ1 補正: service_role に DML 権限を付与
--
-- 背景:
--   サーバー(service_role / SUPABASE_SECRET_KEY)からの customers への upsert が
--   table-level の GRANT 不足で 42501 "permission denied for table customers" になった。
--
-- 設計を壊さないことの確認:
--   ・RLS(行ポリシー)と GRANT(テーブル権限)は別レイヤ。本ファイルは GRANT のみ。
--   ・RLS は引き続き全テーブルで有効・ポリシー0件(deny-by-default)のまま。
--   ・anon / authenticated には一切付与しない
--     → サロン/クライアントからは全遮断を維持（絶対原則8: 個人情報を見せない）。
--   ・service_role は SUPABASE_SECRET_KEY 専用・サーバーのみ・BYPASSRLS。付与して安全。

-- 既存8テーブルへ付与
grant select, insert, update, delete
  on all tables in schema public
  to service_role;

-- 今後のマイグレーションで作るテーブルにも自動適用（postgres ロールが作成する想定）
alter default privileges in schema public
  grant select, insert, update, delete on tables
  to service_role;
