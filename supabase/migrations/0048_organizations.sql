-- ⚠️ 適用済み（2026-09-23 13:06、SQL エディタで手動適用）・再実行しない
--    適用後の確認済み: organizations 2件 / organization_members は carta 1件 /
--    salons の振り分け carta 5件・echo Labs 2件・org_id は NOT NULL /
--    organizations・organization_members とも RLS = true・ポリシー0件 /
--    FK の on delete は salons.org_id = restrict・salon_invites.org_id = restrict・
--    organization_members.org_id = cascade。
--    本番の /dashboard・/staff・/mypage が従来どおり表示されることを実機で確認済み。
--
-- 0048_organizations.sql
-- §21 /owner — 組織（organization）概念の導入。
--
-- 背景:
--   staff は「1行 = 1サロン」で、line_user_id に全体 unique（uq_staff_line_user_id /
--   staff_line_user_id_active_uniq の2本が本番に実在）が掛かっている。
--   その結果、既に staff 行を持つ人が /manager/salon/new で2店舗目を作ると
--   staff の INSERT が unique 違反で落ち、salon ごとロールバックされる
--   （src/app/api/manager/salon/new/route.ts:172-191 が既知として明記）。
--   「1人のオーナーが複数サロンを持つ」を表現する場所がスキーマに無い。
--
--   そこで **サロンの上に組織を置く**。オーナーであることは staff.role ではなく
--   organization_members で持つ（staff は従来どおり「サロンに属する評価対象」のまま）。
--
-- この migration がやらないこと（意図的）:
--   ・staff テーブルには一切触らない（列追加も index 変更もしない）。
--     上記2本の unique も**そのまま残す**。兼任の解決は /owner を作ってからの別 migration。
--   ・既存の認可の挙動を変えない。org_id は入るだけで、まだどのコードも読まない。
--   ・salon_invites の「使い方（アプリ側の契約）」（0043 末尾）を変えない。org_id を足すだけ。
--   ・オーナー招待テーブルは設計未決のため 0049 以降で追加する。
--
-- ★トランザクション★
--   Supabase の SQL エディタはスクリプト全体を1トランザクションで実行する（0047 の
--   concurrently に関する記述と同根）。下の begin/commit はそれを明示するためのもので、
--   エディタが既にトランザクションを開いている場合 begin は
--   「there is already a transaction in progress」の **WARNING** を出すが、
--   エラーにはならない。どこかの raise exception で全体が巻き戻る。
--   → psql から流す場合もこのまま1トランザクションで通る。

begin;


-- =========================================================
-- ガード 1) salons が事前確認2の7件と完全一致すること
--
--   id で振り分ける以上、想定外の行が1つでもあれば org_id が null のまま残り、
--   最後の NOT NULL 化で落ちる。落ちる場所を手前に寄せて理由を明示する。
-- =========================================================
do $$
declare
  v_total      int;
  v_unexpected int;
begin
  select count(*) into v_total from public.salons;
  if v_total <> 7 then
    raise exception '[0048] salons が7件ではない（実際: % 件）。事前確認2と一致しないため中断する', v_total;
  end if;

  select count(*) into v_unexpected
    from public.salons
   where id not in (
     '682336ef-997e-4b07-876e-b71fb032b71b',  -- テストサロン
     'deded000-0000-0000-0000-000000000000',  -- 【DEMO】echo デモサロン
     '2e47dac3-c686-4428-982e-f484160629f3',  -- CARTA
     'cee978a5-0cfc-4ded-af6b-5c9ba478ab56',  -- Niii
     'eb164dbe-a4f4-44e7-b2f3-62a79b4f8c70',  -- nun Fukushima
     '5d50e8ef-0897-4977-9872-f85d91705695',  -- SELNI
     '52b35774-cce7-4785-9185-35d0fb5e698e'   -- suco
   );
  if v_unexpected <> 0 then
    raise exception '[0048] 事前確認2に無い salon が % 件ある。振り分け先が決まらないため中断する', v_unexpected;
  end if;

  raise notice '[0048] ガード1 OK: salons 7件・id が事前確認2と一致';
end $$;


-- =========================================================
-- ガード 2) carta のオーナーとして引く staff 行が、ちょうど1行・line_user_id あり
--
--   LINE user id は PII（原則7）なので **migration に直書きしない**。
--   事前確認3で特定した staff.id を鍵にして、値は DB から select して入れる。
--   この行が居なくなっている／role が変わっている／未紐付けなら、
--   オーナー不在の組織を作らずに中断する。
-- =========================================================
do $$
declare
  v_rows int;
  v_line text;
begin
  select count(*) into v_rows
    from public.staff
   where id       = '407920ff-dd99-4006-ac90-cc7ae4952414'
     and salon_id = '2e47dac3-c686-4428-982e-f484160629f3'  -- CARTA
     and role     = 'manager'
     and archived_at is null;

  if v_rows <> 1 then
    raise exception '[0048] carta オーナーの staff 行がちょうど1行ではない（実際: % 行）。中断する', v_rows;
  end if;

  select line_user_id into v_line
    from public.staff
   where id = '407920ff-dd99-4006-ac90-cc7ae4952414';

  if v_line is null then
    raise exception '[0048] carta オーナーの staff 行に line_user_id が無い（LINE 未紐付け）。中断する';
  end if;

  raise notice '[0048] ガード2 OK: carta オーナーの staff 行 1件・LINE 紐付けあり';
end $$;


-- =========================================================
-- 1) organizations
--
--   サロンの上位。「誰が経営しているか」の単位。
--   name は表示用（法人名でも屋号でもよい）。住所・法人番号などは今は持たない
--   （必要になった時点で別 migration。空の列を先に作らない）。
-- =========================================================
create table if not exists public.organizations (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  created_at timestamptz not null default now()
);

-- RLS: ポリシーを1本も定義しない＝完全 deny（意図的・0037 / 0043 と同じ作法）。
-- ※ 0031 の event trigger が public への create table で RLS を自動 enable するが、
--    明示的にも書いておく（trigger が外れた環境でも守られるように）。
alter table public.organizations enable row level security;

-- service_role の権限（0039 / 0043 と同じ構図。uuid 主キーなのでシーケンスの grant は不要）。
grant select, insert, update on table public.organizations to service_role;


-- 初期データ（2組織）。id は migration 内で固定採番し、以降の INSERT/UPDATE から参照する。
-- 形式は既存の 'deded000-0000-0000-0000-000000000000'（DEMO サロン）に倣った「人が読める」uuid。
--   ca47a000-… = carta / ec40ab50-… = echo Labs
insert into public.organizations (id, name) values
  ('ca47a000-0000-0000-0000-000000000001', '合同会社carta'),
  ('ec40ab50-0000-0000-0000-000000000002', 'echo Labs（デモ・テスト）')
on conflict (id) do nothing;


-- =========================================================
-- 2) organization_members
--
--   「この LINE アカウントはこの組織のオーナー」だけを持つ。
--   ★staff.role とは別体系★ staff は「サロンに属する評価対象」、
--     organization_members は「組織の経営主体」。混ぜない（0043 の
--     「staff.role には一切触らない」と同じ切り分け）。
--
--   role は今は 'owner' の1値のみ。CHECK で固定しておき、将来 'admin' 等を
--   足すときに **必ずこの migration を読み直してから** 値域を広げさせる
--   （staff_role_check（0016）と同じ作法）。
--
--   unique(line_user_id) = 1人1組織。staff の1 LINE=1行と同じ強度で、
--   「どの組織の人か」が常に一意に解決できることを DB で担保する。
--   ここを緩めると /owner の解決が maybeSingle で静かに null を返す
--   （resolveStaffByLineUserId と同じ事故・60_incidents 2026-09-02）。
-- =========================================================
create table if not exists public.organization_members (
  id           uuid        primary key default gen_random_uuid(),
  org_id       uuid        not null references public.organizations(id) on delete cascade,
  -- LINE user id。PII（原則7）＝ admin / owner 経路以外に出さない。
  line_user_id text        not null,
  role         text        not null default 'owner',
  created_at   timestamptz not null default now(),

  -- 1人1組織。兼任が必要になったらこの制約を外す前に /owner の認可を見直すこと。
  constraint organization_members_line_user_id_key unique (line_user_id),
  -- 値域は 'owner' のみ（将来拡張時はここを広げる）。
  constraint organization_members_role_check check (role = 'owner')
);

-- 組織からメンバーを引く（/owner のメンバー一覧）。
create index if not exists organization_members_org_id_idx
  on public.organization_members (org_id);

alter table public.organization_members enable row level security;
grant select, insert, update on table public.organization_members to service_role;


-- carta のオーナー登録。LINE user id は直書きせず staff 行から select する（ガード2で検証済み）。
insert into public.organization_members (org_id, line_user_id, role)
select
  'ca47a000-0000-0000-0000-000000000001',
  s.line_user_id,
  'owner'
  from public.staff s
 where s.id       = '407920ff-dd99-4006-ac90-cc7ae4952414'
   and s.salon_id = '2e47dac3-c686-4428-982e-f484160629f3'
   and s.role     = 'manager'
   and s.archived_at is null
   and s.line_user_id is not null
on conflict (line_user_id) do nothing;

-- echo Labs 組織にはメンバーを入れない（意図的）。
--   運営は env ADMIN_LINE_USER_IDS で判定しており、DB に運営者を持たない方針
--   （admin-guard.ts / 0043 の注記）。ここに運営者を入れると判定が二重になる。


-- =========================================================
-- 3) salons.org_id
--
--   on delete restrict: サロンを抱えた組織は消せない。組織の削除は
--   「サロンを別組織に移すか、サロンを先に畳むか」を人が決めてからにする
--   （set null にすると org 無しサロンが静かに生まれ、NOT NULL が壊れる）。
-- =========================================================
alter table public.salons
  add column if not exists org_id uuid
  references public.organizations(id) on delete restrict;

create index if not exists salons_org_id_idx
  on public.salons (org_id);

-- 振り分けは **店名ではなく id** で指定する（同名サロンや改名に影響されないため）。
-- 実店舗5つ → 合同会社carta
update public.salons set org_id = 'ca47a000-0000-0000-0000-000000000001'
 where id in (
   '2e47dac3-c686-4428-982e-f484160629f3',  -- CARTA
   'cee978a5-0cfc-4ded-af6b-5c9ba478ab56',  -- Niii
   'eb164dbe-a4f4-44e7-b2f3-62a79b4f8c70',  -- nun Fukushima
   '5d50e8ef-0897-4977-9872-f85d91705695',  -- SELNI
   '52b35774-cce7-4785-9185-35d0fb5e698e'   -- suco
 );

-- DEMO / テスト → echo Labs
update public.salons set org_id = 'ec40ab50-0000-0000-0000-000000000002'
 where id in (
   'deded000-0000-0000-0000-000000000000',  -- 【DEMO】echo デモサロン
   '682336ef-997e-4b07-876e-b71fb032b71b'   -- テストサロン
 );


-- =========================================================
-- ガード 3) NOT NULL 化の前に、org_id が埋まっていることを確認する
--
--   「作成」≠「適用」≠「記録」（docs/40_decisions.md §1）。
--   NOT NULL は埋め残しがあれば落ちるが、落ちる理由が分かる形にしておく。
-- =========================================================
do $$
declare
  v_null  int;
  v_carta int;
  v_echo  int;
begin
  select count(*) into v_null from public.salons where org_id is null;
  if v_null <> 0 then
    raise exception '[0048] org_id が null の salon が % 件残っている。NOT NULL 化を中断する', v_null;
  end if;

  select count(*) into v_carta from public.salons
   where org_id = 'ca47a000-0000-0000-0000-000000000001';
  select count(*) into v_echo  from public.salons
   where org_id = 'ec40ab50-0000-0000-0000-000000000002';

  if v_carta <> 5 or v_echo <> 2 then
    raise exception '[0048] 振り分け件数が想定と違う（carta: % / 想定5、echo Labs: % / 想定2）。中断する', v_carta, v_echo;
  end if;

  raise notice '[0048] ガード3 OK: org_id 埋め残しなし・carta 5件 / echo Labs 2件';
end $$;

alter table public.salons
  alter column org_id set not null;


-- =========================================================
-- 4) salon_invites.org_id
--
--   「この招待コードで作るサロンは、この組織に属する」。
--   NULL 可（既存3行は組織の概念より前に発行されたもの＝遡って埋めない。0045 と同じ方針で
--   NULL の意味は「組織が決まっていない」であって「組織が無い」ではない）。
--   on delete restrict: 招待の履歴が組織の削除を止める。履歴は消さない。
--
--   ★0043 末尾の「使い方（アプリ側の契約・変更しないこと）」は変えない★
--     消費は従来どおり `update ... where code=$1 and used_at is null and expires_at > now()`。
--     org_id は発行時に入れる列で、消費の条件には入れない。
-- =========================================================
alter table public.salon_invites
  add column if not exists org_id uuid
  references public.organizations(id) on delete restrict;

create index if not exists salon_invites_org_id_idx
  on public.salon_invites (org_id);


-- テーブル・列を追加したので PostgREST のスキーマキャッシュをリロード（§3・0024 / 0044 / 0045 と同じ）。
notify pgrst, 'reload schema';

commit;


-- =========================================================
-- 適用後の確認クエリ（SQL エディタで別途実行して目視すること）
--
--   -- 組織が2件・名前が正しいか
--   select id, name, created_at from public.organizations order by created_at;
--
--   -- carta のオーナーが1件入ったか（line_user_id は出さない）
--   select o.name, count(m.id) as members
--     from public.organizations o
--     left join public.organization_members m on m.org_id = o.id
--    group by o.name order by o.name;
--
--   -- サロンの振り分け（carta 5 / echo Labs 2・null 0）
--   select coalesce(o.name, '(org_id が null)') as org, count(*) as salons
--     from public.salons s
--     left join public.organizations o on o.id = s.org_id
--    group by 1 order by 1;
--
--   -- salons.org_id が NOT NULL になったか
--   select column_name, is_nullable, data_type
--     from information_schema.columns
--    where table_schema='public' and table_name='salons' and column_name='org_id';
--
--   -- 新テーブルが RLS 有効・ポリシー0件か（0043 の適用後確認と同じ）
--   select c.relname, c.relrowsecurity,
--          (select count(*) from pg_policies p
--            where p.schemaname='public' and p.tablename=c.relname) as policies
--     from pg_class c join pg_namespace n on n.oid=c.relnamespace
--    where n.nspname='public'
--      and c.relname in ('organizations','organization_members');
--
--   -- FK の on delete 挙動（restrict / cascade が意図どおりか）
--   select conrelid::regclass as tbl, conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where contype='f'
--      and conrelid in ('public.salons'::regclass,
--                       'public.salon_invites'::regclass,
--                       'public.organization_members'::regclass)
--      and pg_get_constraintdef(oid) like '%organizations%';
-- =========================================================
