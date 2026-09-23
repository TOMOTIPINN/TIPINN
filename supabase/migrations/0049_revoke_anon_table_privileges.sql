-- ⚠️ 適用済み（2026-09-23 18:22、SQL エディタで手動適用）・再実行しない
--    適用後の確認済み: Postgres 17.6（MAINTAIN あり）/
--    public のテーブルに anon・authenticated の grant は0件 /
--    pg_default_acl（public / tables / postgres）は postgres と service_role のみ /
--    service_role は17テーブルすべてで権限あり /
--    anon・authenticated の実効 TRUNCATE は17テーブル中0。
--    本番の /manager/staff でプロフィールの保存（staff の UPDATE）が通ることを実機で確認済み。
--
-- 0049_revoke_anon_table_privileges.sql
-- public の全テーブルから anon / authenticated の TRUNCATE / REFERENCES / TRIGGER
-- （PG17+ では MAINTAIN も）を剥がし、今後作るテーブルにも付かないようにする。
--
-- 経緯（2026-09-23 の月次セキュリティ診断で発見）:
--   public の **全17テーブル**で、`anon` と `authenticated` の ACL が `Dxtm`
--   （D=TRUNCATE / x=REFERENCES / t=TRIGGER / m=MAINTAIN）になっていた。
--   出所はテーブルごとの GRANT ではなく **postgres の既定の権限付与**
--   （`pg_default_acl`: defaclrole=postgres / defaclnamespace=public / defaclobjtype=r で
--   anon=Dxtm / authenticated=Dxtm）。つまり `create table` するたびに自動で付く。
--
-- なぜ塞ぐか:
--   ・**TRUNCATE は RLS を素通りする。** RLS は行に効くが TRUNCATE はテーブル単位の操作で、
--     ポリシー0件（deny-by-default）でも止まらない。全テーブルのデータを消せる権限が
--     anon に付いている状態だった（→ `50_security.md` §5-3）。
--   ・REFERENCES / TRIGGER / MAINTAIN も、無いと困る場面がこのアプリには無い。
--   ・**echo のアプリは anon / publishable キーで DB を触っていない**（2026-09-23 確認。
--     `supabase-admin.ts` の service_role クライアント1つだけで、クライアント側から
--     supabase-js でテーブルを読み書きしている箇所は0件）。よって剥がしても影響が無い。
--
-- 到達可能性（**推測**）:
--   PostgREST（`/rest/v1`）に TRUNCATE を発行する口は無いため、**現状の実害は無いと考えている**。
--   ただし「到達経路が思いつかない」は防御ではない。権限そのものを外す。
--
-- この migration がやらないこと（意図的）:
--   ・**`service_role` と `postgres` の権限には触らない。** アプリの全 DB 操作は
--     service_role（`@/lib/supabase-admin`）を通る。ここを削ると全機能が止まる。
--   ・**`public` 以外のスキーマに触らない**（`storage` / `graphql` / `auth` / `realtime` など
--     Supabase の管理領域）。あちらは Supabase 側の運用が前提で、剥がすと管理画面や
--     Storage が壊れうる。今回の診断の対象も public のみ。
--   ・**`supabase_admin` の既定の権限付与には触らない。** 触るのは
--     `for role postgres in schema public` の1本だけ。
--   ・**SELECT / INSERT / UPDATE / DELETE は対象外。** 診断時点で anon / authenticated には
--     そもそも付いていない（ACL は `Dxtm` のみ）。RLS の deny-by-default（ポリシー0件）は変更しない。
--   ・**RLS・ポリシー・テーブル定義・データには一切触らない。**
--
-- ★Postgres のバージョン★
--   MAINTAIN は **PG17 で追加された**権限で、PG16 以前には存在しない。
--   `revoke ... maintain ...` と直接書くと PG16 以前では**構文エラーで全体が落ちる**ため、
--   下では `server_version_num` を見て**動的 SQL で権限リストを組み立てる**。
--   どちらのバージョンでもこのファイル1本で通る。
--
-- ★トランザクション★
--   Supabase の SQL エディタはスクリプト全体を1トランザクションで実行する（0047 / 0048 と同じ）。
--   下の begin/commit はそれを明示するためのもので、エディタが既にトランザクションを
--   開いている場合 begin は「there is already a transaction in progress」の **WARNING** を
--   出すが、エラーにはならない。最後のガードの raise exception で全体が巻き戻る。

begin;


-- =========================================================
-- 1) 既存のテーブルから剥がす
--
--   `all tables in schema public` は**ビューや外部テーブルも含む**が、
--   この4権限はどちらにとっても不要なので対象に含めて問題ない
--   （2026-09-23 時点の public は17テーブル・ビュー0）。
--
--   ★revoke は「付いていない権限」に対して実行してもエラーにならない★
--   ので、対象を絞り込まず一律に流してよい。
-- =========================================================
do $$
declare
  v_privs text := 'TRUNCATE, REFERENCES, TRIGGER';
begin
  -- MAINTAIN は PG17+ のみ。無いバージョンで書くと構文エラーになる。
  if current_setting('server_version_num')::int >= 170000 then
    v_privs := v_privs || ', MAINTAIN';
  end if;

  execute format(
    'revoke %s on all tables in schema public from anon, authenticated',
    v_privs
  );

  -- =========================================================
  -- 2) これから作るテーブルにも付かないようにする
  --
  --   本体はこちら。1) だけだと、次に `create table` した瞬間にまた `Dxtm` が付く
  --   （0048 で作った organizations / organization_members が実際にそうなった）。
  --
  --   `for role postgres` は **postgres が作るオブジェクト**の既定値。
  --   migration は SQL エディタ（postgres）で流すので、これで塞がる。
  --   supabase_admin など他のロールの既定値には触らない。
  -- =========================================================
  execute format(
    'alter default privileges for role postgres in schema public '
    'revoke %s on tables from anon, authenticated',
    v_privs
  );
end $$;


-- =========================================================
-- 3) ガード: public のテーブルに anon / authenticated の権限が残っていないこと
--
--   見るのは **テーブル自身の ACL に明示的に入っている grant**（`relacl` を aclexplode）。
--   `has_table_privilege()` ではなく `relacl` を見るのは、
--   PUBLIC への grant やロールの継承まで拾ってしまうと、
--   **この migration では直せないものでトランザクションが落ちる**ため。
--   ここで確かめたいのは「1) と 2) が効いたか」であって、それ以外の経路は
--   末尾の確認クエリで別途見る。
--
--   relacl が NULL のテーブル＝既定（所有者のみ）なので、そもそも anon の行は出ない。
-- =========================================================
do $$
declare
  v_rows int;
  v_detail text;
begin
  select count(*), string_agg(distinct c.relname || '/' || a.grantee::regrole::text, ', ')
    into v_rows, v_detail
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
   where n.nspname = 'public'
     and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and a.grantee::regrole::text in ('anon', 'authenticated');

  if v_rows <> 0 then
    raise exception
      '[0049] public のテーブルに anon / authenticated の権限が % 件残っている（%）。中断する',
      v_rows, v_detail;
  end if;

  raise notice '[0049] ガード OK: public のテーブルに anon / authenticated の grant は0件';
end $$;


-- =========================================================
-- 4) ガード: 既定の権限付与からも消えていること
--
--   `pg_default_acl` の public / tables / postgres の行に anon / authenticated が
--   残っていないか。行そのものが消えることもある（その場合は0件）。
-- =========================================================
do $$
declare
  v_rows int;
begin
  select count(*)
    into v_rows
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) a
   where n.nspname = 'public'
     and d.defaclobjtype = 'r'
     and d.defaclrole = 'postgres'::regrole
     and a.grantee::regrole::text in ('anon', 'authenticated');

  if v_rows <> 0 then
    raise exception
      '[0049] 既定の権限付与に anon / authenticated が % 件残っている。中断する', v_rows;
  end if;

  raise notice '[0049] ガード OK: pg_default_acl(public/tables/postgres) に anon / authenticated は0件';
end $$;

commit;


-- =========================================================
-- 適用後の確認クエリ（SQL エディタで別途実行して目視すること）
--
--   -- Postgres のバージョン（MAINTAIN の有無）
--   select current_setting('server_version') as version,
--          current_setting('server_version_num')::int >= 170000 as has_maintain;
--
--   -- public のテーブルの ACL に anon / authenticated が残っていないか（0件が正）
--   select c.relname, a.grantee::regrole::text as grantee, a.privilege_type
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--     cross join lateral aclexplode(c.relacl) a
--    where n.nspname = 'public'
--      and a.grantee::regrole::text in ('anon','authenticated')
--    order by 1, 2, 3;
--
--   -- 既定の権限付与（0件、または anon/authenticated を含まない行だけが正）
--   select d.defaclrole::regrole::text as for_role,
--          n.nspname, d.defaclobjtype, d.defaclacl
--     from pg_default_acl d
--     join pg_namespace n on n.oid = d.defaclnamespace
--    where n.nspname = 'public';
--
--   -- service_role が壊れていないこと（**ここが空になったらアプリが止まる**）
--   select c.relname, a.privilege_type
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--     cross join lateral aclexplode(c.relacl) a
--    where n.nspname = 'public'
--      and a.grantee::regrole::text = 'service_role'
--    order by 1, 2;
--
--   -- PUBLIC 経由で TRUNCATE 等が付いていないか（この migration の対象外・別途判断する）
--   select c.relname, a.privilege_type
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--     cross join lateral aclexplode(c.relacl) a
--    where n.nspname = 'public'
--      and a.grantee = 0   -- 0 = PUBLIC
--    order by 1, 2;
--
--   -- 実効権限でも落ちていること（継承・PUBLIC 込みの最終確認。false が並ぶのが正）
--   select t.tablename,
--          has_table_privilege('anon',          format('public.%I', t.tablename), 'TRUNCATE')   as anon_truncate,
--          has_table_privilege('authenticated', format('public.%I', t.tablename), 'TRUNCATE')   as auth_truncate,
--          has_table_privilege('anon',          format('public.%I', t.tablename), 'REFERENCES') as anon_references,
--          has_table_privilege('anon',          format('public.%I', t.tablename), 'TRIGGER')    as anon_trigger
--     from pg_tables t
--    where t.schemaname = 'public'
--    order by 1;
--
--   -- アプリが動くこと（適用後に実機で）: /review の送信・/rating の決済・
--   --   /staff/visit の来店記録・/dashboard の表示。すべて service_role 経由なので
--   --   影響は無い想定だが、書き込み系を1つは実際に通すこと（0037→0039 の教訓）。
-- =========================================================
