-- ⚠️ 適用済み（2026-10-08 19:26 JST ごろ、SQL エディタで手動適用・結果「Success. No rows returned」）・再実行しない
--    適用前にチャットで全文をレビュー済み（40_decisions.md §6.3）。
--    適用後の確認済み（同日 19:27・読み取りだけ）: 免除は carta / echo Labs / テスト（確認用・店舗なし）= true・
--    L/MA = false ／ FK は org_id = RESTRICT・accepted_by_member_id = SET NULL・CHECK 2本・PK ／
--    RLS 有効・ポリシー0件・行0件 ／ anon・authenticated の select / insert / update / delete はすべて false・
--    service_role は select・insert だけ true ／ 関数2本とも execute は service_role だけ ／
--    organization_members・organization_terms_acceptances のトリガー0件。
--    末尾の確認クエリのうち Q1・Q4・Q5・Q7・Q9・Q11 に当たる内容を1本にまとめて流した。
--    **Q2・Q3・Q6・Q8・Q10 は個別には流していない**（ガード2 が通ったことで代えた）。
--    対照群（同日 19:28〜19:29・原のアカウント）: /owner に carta の5店舗が従来どおり出る／
--    /owner/join にでたらめなコードで error=not_found（古い consume_owner_invite の経路が生きている）。
--    詳細は 40_decisions.md §26「0051 の適用と確認」。
--
-- 0051_organization_terms_acceptances.sql
-- §26 C1 — サロン向け利用規約への同意（組織ごとの記録・既存組織の免除・同意を伴うオーナー招待の消費）。
--
-- 経緯（docs/40_decisions.md §26「決定（原の判断・2026-10-08）」）:
--   ・同意はオーナー招待の受諾（/owner/join）で取る。契約の相手は事業者（組織）（決定1）。
--   ・記録は別テーブルで履歴として持ち、追記だけ。同意した人は member_id（set null）と
--     line_user_id の写しの両方を持つ（決定2）。
--   ・版は確定日の日付形式。版の正はアプリのコードの定数で、DB は形式の CHECK だけ（決定4）。
--   ・既存の組織は免除の列で扱う。免除は carta・echo Labs・旧テスト組織の3つ。L/MA は免除しない（決定5）。
--   ・RPC は新しい名前の関数を作る。古い consume_owner_invite は残す（決定6・10/21 まで必ず残す）。
--
-- 本番の consume_owner_invite の定義は 2026-10-08 に照合済み（0050 のファイルと完全一致・§26）。
-- 下の accept_owner_invite は、その本文に次の3点だけを足したもの:
--   (a) 先頭の入力確認に p_terms_version の null / 空 → invalid_input、形式違い → invalid_terms
--   (b) savepoint のブロックの中、3-3 の後に同意の記録（4)）
--   (c) 関数名と引数（p_terms_version）
--   判定の順（コードの確認 → すでにオーナーか → 書き込み）は変えない（§21「2026-09-24 決定」3）。
--
-- この migration がやらないこと（意図的）:
--   ・consume_owner_invite には触らない（定義・権限とも）。10/21 まで今のアプリがこれを呼ぶ。
--   ・organization_members・owner_invites・salons・salon_invites の定義には触らない。
--   ・どのテーブルにもトリガーを付けない（0050 決定6 と同じ。line_user_id を audit_log に入れない）。
--   ・同意済みかどうかの判定は持たない。判定はアプリ側（サロン作成の route・§26 決定3・C4）。
--   ・同意の行は入れない（既存の組織は「同意した」ではなく「免除」で扱う・§26 採らなかった案 4-2）。
--
-- ★トランザクション★
--   Supabase の SQL エディタはスクリプト全体を1トランザクションで実行する（0047〜0050 と同じ）。
--   エディタが既にトランザクションを開いている場合 begin は WARNING を出すが、エラーにはならない。
--   どこかの raise exception で全体が巻き戻る。
--   ガードの結果は raise notice ではなく raise exception で示す（§1.12）。

begin;


-- =========================================================
-- ガード 1) 前提の確認
--
--   ・新しい列・テーブル・関数がまだ無いこと（if not exists で黙って素通りさせない）
--   ・古い関数が1本だけ残っていること（この migration は触らない）
--   ・関数の例外処理が名前で見ている unique 制約が、本番の名前どおりであること
--   ・organization_members にトリガーが無いこと（0050 決定6 のまま）
--   ・免除する3組織と L/MA が、id と名前の両方で一致すること
--     名前も見るのは、id の写し間違いを止めるため。/admin/organizations で名前を
--     直していたら（5c）ここで止まる＝直した名前に合わせてから流す。
--     組織の総数は見ない（原が確認用のテスト組織を先に作っていても通す。
--     それ以外の組織は既定値 false＝免除しない、が正しい扱い）。
-- =========================================================
do $$
declare
  v_n int;
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'organizations'
       and column_name = 'terms_exempt'
  ) then
    raise exception '[0051] organizations.terms_exempt が既に存在する。中断する';
  end if;

  if to_regclass('public.organization_terms_acceptances') is not null then
    raise exception '[0051] public.organization_terms_acceptances が既に存在する。中断する';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'accept_owner_invite'
  ) then
    raise exception '[0051] public.accept_owner_invite が既に存在する。中断する';
  end if;

  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'consume_owner_invite';
  if v_n <> 1 then
    raise exception '[0051] consume_owner_invite が % 本ある（1本が前提）。中断する', v_n;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.organization_members'::regclass
       and conname  = 'organization_members_line_user_id_key'
       and contype  = 'u'
  ) then
    raise exception '[0051] organization_members_line_user_id_key が見つからない。中断する';
  end if;

  if exists (
    select 1 from pg_trigger
     where tgrelid = 'public.organization_members'::regclass
       and not tgisinternal
  ) then
    raise exception '[0051] organization_members にトリガーがある（0050 決定6 の前提と違う）。中断する';
  end if;

  select count(*) into v_n
    from public.organizations o
    join (values
      ('ca47a000-0000-0000-0000-000000000001'::uuid, '合同会社carta'),
      ('ec40ab50-0000-0000-0000-000000000002'::uuid, 'echo Labs（デモ・テスト）'),
      ('c308955c-0e59-4d4e-a288-5d4e78804583'::uuid, 'テスト（確認用・店舗なし）'),
      ('98e46135-07ef-43f3-9da8-7f6dddad4443'::uuid, 'L/MA')
    ) as e(id, name)
      on e.id = o.id and e.name = o.name;
  if v_n <> 4 then
    raise exception '[0051] 免除する3組織と L/MA が id・名前で一致しない（一致 % / 4）。中断する', v_n;
  end if;
end $$;


-- =========================================================
-- 1) organizations.terms_exempt — 規約への同意を求めない組織
--
--   true  = サロン作成の判定（§26 決定3）をしない。規約より前から使っている組織。
--   false = 同意の行が無ければ、その組織のサロンを作れない（判定はアプリ側・C4）。
--   既定値 false: 新しく作る組織（/api/admin/organizations は name だけを INSERT する）は
--   自動で「免除しない」になる。免除を足すときは SQL で明示的に true にする。
--
--   「同意した」とは別の事実なので、同意のテーブルには行を入れない（§26 採らなかった案 4-2）。
--   carta が後で同意したら、同意の行が入った後でこの列を false に戻せる。
-- =========================================================
alter table public.organizations
  add column terms_exempt boolean not null default false;

comment on column public.organizations.terms_exempt is
  'サロン向け利用規約への同意を求めない組織（規約より前から使っている組織）。docs/40_decisions.md §26 決定5。';

-- 振り分けは名前ではなく id（0048 と同じ作法）。ガード1 で id と名前の一致は確認済み。
do $$
declare
  v_n int;
begin
  update public.organizations
     set terms_exempt = true
   where id in (
     'ca47a000-0000-0000-0000-000000000001',  -- 合同会社carta
     'ec40ab50-0000-0000-0000-000000000002',  -- echo Labs（デモ・テスト）
     'c308955c-0e59-4d4e-a288-5d4e78804583'   -- テスト（確認用・店舗なし）
   );
  get diagnostics v_n = row_count;
  if v_n <> 3 then
    raise exception '[0051] 免除の更新が3行ではない（% 行）。中断する', v_n;
  end if;
end $$;


-- =========================================================
-- 2) organization_terms_acceptances — サロン向け利用規約への同意の履歴
--
--   1行 = 「ある組織のオーナーが、ある版に、ある時刻に同意した」。追記だけ。
--   ・org_id: on delete restrict（同意の記録が組織の削除を止める。salons.org_id と同じ）。
--   ・terms_version: 確定日の日付形式（例 2026-10-14）。版の正はアプリの定数で、ここは形式だけを縛る。
--     text→date のキャストは DateStyle に依存して immutable でないため、CHECK は正規表現にする。
--   ・accepted_by_member_id: on delete set null。メンバー行を消しても同意の記録は残す
--     （2026-10-02 の片付けでメンバー行を直接消した実例がある）。
--   ・accepted_by_line_user_id: 同意した人の LINE ID の写し。**PII（原則7）**。
--     member_id が null になっても、誰が同意したかが残る。退会時の扱いは未決（70_legal.md §7.7）。
--   unique は付けない（同じ組織の別のオーナー・別の版への同意を、どれも記録する）。
-- =========================================================
create table public.organization_terms_acceptances (
  id                       uuid        primary key default gen_random_uuid(),
  org_id                   uuid        not null references public.organizations(id) on delete restrict,
  terms_version            text        not null,
  accepted_at              timestamptz not null default now(),
  accepted_by_member_id    uuid        references public.organization_members(id) on delete set null,
  accepted_by_line_user_id text        not null,

  constraint organization_terms_acceptances_version_format
    check (terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  constraint organization_terms_acceptances_line_user_id_not_blank
    check (btrim(accepted_by_line_user_id) <> '')
);

comment on table public.organization_terms_acceptances is
  'サロン向け利用規約への同意の履歴（組織ごと・追記だけ）。docs/40_decisions.md §26。accepted_by_line_user_id は PII。';

-- 判定（その組織に同意の行があるか・C4）と、組織ごとの履歴の表示。
create index organization_terms_acceptances_org_id_idx
  on public.organization_terms_acceptances (org_id, accepted_at desc);

-- RLS: ポリシーを1本も定義しない＝完全 deny（0037 / 0043 / 0048 / 0050 と同じ作法）。
-- ※ 0031 の event trigger が RLS を自動 enable するが、明示的にも書いておく。
alter table public.organization_terms_acceptances enable row level security;

-- service_role の権限: **select と insert だけ**（追記だけ・§26 決定2）。
--   pg_default_acl（postgres / public）は service_role に全権限を付ける（0049 の確認記録）ので、
--   いったん全部外してから2つだけ付け直す。
--   アプリ（@/lib/supabase-admin）からは UPDATE / DELETE / TRUNCATE ができない。
--   書き込みは accept_owner_invite（security definer＝所有者 postgres の権限）か、SQL エディタ（postgres）だけ。
--   anon / authenticated には何も付かない（0049 で既定の権限付与から外し済み。ガード2 で確認する）。
revoke all on table public.organization_terms_acceptances from service_role;
grant select, insert on table public.organization_terms_acceptances to service_role;


-- =========================================================
-- 3) accept_owner_invite — 招待の消費・オーナー登録・規約への同意を1つの関数で行う
--
--   引数: p_code          = 正規化済みのコード（normalizeInviteCode を通したもの）
--         p_line_user_id  = サーバーのセッション由来の LINE user id（クライアントから受け取らない）
--         p_terms_version = 同意した規約の版（アプリの定数。クライアントから受け取らない）
--   戻り値: 1行。status と joined_org_id（consume_owner_invite と同じ形）。
--     status = 'ok'            → joined_org_id にオーナーになった組織。同意の行も1件入っている
--              'invalid_input' → 引数が null / 空
--              'invalid_terms' → 版の形式が違う（アプリの不具合。利用者の入力ではない）
--              'not_found' / 'used' / 'expired' / 'already_owner' → consume_owner_invite と同じ
--     失敗のときは joined_org_id = null。**例外では終わらせない**（想定外のエラーだけ raise）。
--
--   ★consume_owner_invite との違いは、ヘッダーの (a)(b)(c) だけ★
--     判定の順（コードの確認 → すでにオーナーか → 書き込み）は同じ。
--     同意の記録は savepoint のブロックの中なので、招待の消費・メンバー行・同意の行は
--     **全部入るか、全部戻るか**のどちらか（「オーナーだが同意の記録が無い」を作らない）。
--     already_owner（同時に2本使われた場合を含む）では、同意の行も一緒に巻き戻る。
--
--   search_path は consume_owner_invite と同じ `public` に固定し、本文のテーブルもすべて `public.` で修飾する。
-- =========================================================
create function public.accept_owner_invite(
  p_code          text,
  p_line_user_id  text,
  p_terms_version text
)
returns table (status text, joined_org_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite     public.owner_invites%rowtype;
  v_member_id  uuid;
  v_constraint text;
begin
  if p_code is null or p_code = ''
     or p_line_user_id is null or btrim(p_line_user_id) = ''
     or p_terms_version is null or p_terms_version = '' then
    status := 'invalid_input'; joined_org_id := null;
    return next; return;
  end if;

  -- (a) 版の形式。テーブルの CHECK と同じ式。ここで弾けば、書き込みのブロックで
  --     check_violation を起こして想定外のエラーにすることがない。
  if p_terms_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    status := 'invalid_terms'; joined_org_id := null;
    return next; return;
  end if;

  -- 1) コードの確認。行を押さえて、同じコードの同時消費を直列にする。
  select * into v_invite
    from public.owner_invites i
   where i.code = p_code
   for update;

  if not found then
    status := 'not_found'; joined_org_id := null;
    return next; return;
  end if;

  if v_invite.used_at is not null then
    status := 'used'; joined_org_id := null;
    return next; return;
  end if;

  if v_invite.expires_at <= now() then
    status := 'expired'; joined_org_id := null;
    return next; return;
  end if;

  -- 2) すでにどこかの組織のオーナーか（書き込みの前に弾く）。
  if exists (
    select 1 from public.organization_members m
     where m.line_user_id = p_line_user_id
  ) then
    status := 'already_owner'; joined_org_id := null;
    return next; return;
  end if;

  -- 3) 書き込み。このブロックは savepoint になり、例外を受けたらブロック内の変更だけが巻き戻る。
  begin
    -- 3-1) 招待を条件付きで消費する（0043 の消費と同じ条件）。
    update public.owner_invites i
       set used_at = now()
     where i.id = v_invite.id
       and i.used_at is null
       and i.expires_at > now();

    if not found then
      -- 上で行を押さえ、同じ now() で判定しているので通常は起きない。
      -- 起きたら、その時点の行を見て分類する。
      select * into v_invite from public.owner_invites i where i.id = v_invite.id;
      if v_invite.used_at is not null then
        status := 'used';
      else
        status := 'expired';
      end if;
      joined_org_id := null;
      return next; return;
    end if;

    -- 3-2) オーナーとして登録する。
    insert into public.organization_members (org_id, line_user_id, role)
    values (v_invite.org_id, p_line_user_id, 'owner')
    returning id into v_member_id;

    -- 3-3) どのメンバー行になったかを記録する。
    update public.owner_invites i
       set used_member_id = v_member_id
     where i.id = v_invite.id;

    -- (b) 4) 規約への同意を記録する（§26 決定2）。免除の組織（terms_exempt）でも記録する
    --        （免除は「サロン作成の判定をしない」であって「同意を記録しない」ではない）。
    insert into public.organization_terms_acceptances
      (org_id, terms_version, accepted_at, accepted_by_member_id, accepted_by_line_user_id)
    values
      (v_invite.org_id, p_terms_version, now(), v_member_id, p_line_user_id);

  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      -- 同じ人が別の招待を同時に使い、先に登録された場合だけ already_owner に畳む。
      -- それ以外の unique 違反（想定外）は握りつぶさずに上げる。
      -- （organization_terms_acceptances には unique が無いので、ここに来るのは従来と同じ制約だけ）
      if v_constraint = 'organization_members_line_user_id_key' then
        status := 'already_owner'; joined_org_id := null;
        return next; return;
      end if;
      raise;
  end;

  status := 'ok'; joined_org_id := v_invite.org_id;
  return next;
end;
$$;

-- 呼べるのは service_role だけ（0050 と同じ。0038→0040 の事故を踏まないよう grant も同じ場所に書く）。
revoke all on function public.accept_owner_invite(text, text, text) from public, anon, authenticated;
grant execute on function public.accept_owner_invite(text, text, text) to service_role;


-- =========================================================
-- ガード 2) 適用結果の確認（落ちたら全体が巻き戻る）
--
--   ・免除: true はちょうど3組織で、L/MA は false
--   ・同意のテーブル: RLS 有効・ポリシー0件・行0件
--   ・ACL に anon / authenticated / PUBLIC が無い
--   ・service_role は select / insert だけ（update / delete / truncate は無い）
--   ・accept_owner_invite が1本・anon / authenticated から実行できない・service_role は実行できる
--   ・consume_owner_invite は1本のまま・service_role が実行できるまま（触っていない）
-- =========================================================
do $$
declare
  v_n        int;
  v_rls      boolean;
  v_policies int;
begin
  select count(*) into v_n from public.organizations where terms_exempt;
  if v_n <> 3 then
    raise exception '[0051] terms_exempt = true が % 組織（3が正）。中断する', v_n;
  end if;
  if exists (
    select 1 from public.organizations
     where id = '98e46135-07ef-43f3-9da8-7f6dddad4443' and terms_exempt
  ) then
    raise exception '[0051] L/MA が免除になっている。中断する';
  end if;

  select c.relrowsecurity into v_rls
    from pg_class c where c.oid = 'public.organization_terms_acceptances'::regclass;
  select count(*) into v_policies
    from pg_policies where schemaname = 'public' and tablename = 'organization_terms_acceptances';
  if not v_rls or v_policies <> 0 then
    raise exception '[0051] organization_terms_acceptances の RLS が想定と違う（rls=% / policies=%）。中断する', v_rls, v_policies;
  end if;

  select count(*) into v_n from public.organization_terms_acceptances;
  if v_n <> 0 then
    raise exception '[0051] organization_terms_acceptances に % 行ある（0が正）。中断する', v_n;
  end if;

  select count(*) into v_n
    from pg_class c
    cross join lateral aclexplode(c.relacl) a
   where c.oid = 'public.organization_terms_acceptances'::regclass
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'));
  if v_n <> 0 then
    raise exception '[0051] organization_terms_acceptances に anon / authenticated / PUBLIC の権限が % 件ある。中断する', v_n;
  end if;

  if not has_table_privilege('service_role', 'public.organization_terms_acceptances', 'SELECT')
  or not has_table_privilege('service_role', 'public.organization_terms_acceptances', 'INSERT') then
    raise exception '[0051] service_role が organization_terms_acceptances を select / insert できない。中断する';
  end if;
  if has_table_privilege('service_role', 'public.organization_terms_acceptances', 'UPDATE')
  or has_table_privilege('service_role', 'public.organization_terms_acceptances', 'DELETE')
  or has_table_privilege('service_role', 'public.organization_terms_acceptances', 'TRUNCATE') then
    raise exception '[0051] service_role が organization_terms_acceptances を update / delete / truncate できる（追記だけが正）。中断する';
  end if;

  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'accept_owner_invite';
  if v_n <> 1 then
    raise exception '[0051] accept_owner_invite が % 本ある（1本が正）。中断する', v_n;
  end if;

  if has_function_privilege('anon',          'public.accept_owner_invite(text, text, text)', 'EXECUTE')
  or has_function_privilege('authenticated', 'public.accept_owner_invite(text, text, text)', 'EXECUTE') then
    raise exception '[0051] accept_owner_invite を anon / authenticated が実行できる。中断する';
  end if;
  if not has_function_privilege('service_role', 'public.accept_owner_invite(text, text, text)', 'EXECUTE') then
    raise exception '[0051] accept_owner_invite を service_role が実行できない（0038→0040 と同じ事故）。中断する';
  end if;

  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'consume_owner_invite';
  if v_n <> 1 then
    raise exception '[0051] consume_owner_invite が % 本になった（1本のままが正）。中断する', v_n;
  end if;
  if not has_function_privilege('service_role', 'public.consume_owner_invite(text, text)', 'EXECUTE') then
    raise exception '[0051] consume_owner_invite を service_role が実行できなくなった。中断する';
  end if;
end $$;


-- 列・テーブル・関数を追加したので PostgREST のスキーマキャッシュをリロード（0048 / 0050 と同じ）。
notify pgrst, 'reload schema';

commit;


-- =========================================================
-- 適用後の確認クエリ（**読み取りだけ**。SQL エディタで別途実行して目視すること）
--
--   -- Q1. 免除の振り分け（carta / echo Labs / テスト（確認用・店舗なし）= true、L/MA と他 = false）
--   select id, name, terms_exempt, created_at
--     from public.organizations
--    order by created_at;
--
--   -- Q2. 列の定義（terms_exempt: boolean / NO / false）
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'organizations'
--    order by ordinal_position;
--
--   -- Q3. 同意のテーブルの列（6列: id / org_id / terms_version / accepted_at /
--   --   accepted_by_member_id / accepted_by_line_user_id）
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'organization_terms_acceptances'
--    order by ordinal_position;
--
--   -- Q4. 制約（FK: org_id = RESTRICT / accepted_by_member_id = SET NULL、CHECK 2本、PK）
--   select conname, contype, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.organization_terms_acceptances'::regclass
--    order by contype, conname;
--
--   -- Q5. RLS 有効・ポリシー0件・行0件
--   select c.relrowsecurity,
--          (select count(*) from pg_policies p
--            where p.schemaname = 'public' and p.tablename = 'organization_terms_acceptances') as policies,
--          (select count(*) from public.organization_terms_acceptances) as rows
--     from pg_class c
--    where c.oid = 'public.organization_terms_acceptances'::regclass;
--
--   -- Q6. テーブルの ACL（service_role は select と insert だけ。anon / authenticated / PUBLIC の行が無いのが正）
--   select coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') as grantee, a.privilege_type
--     from pg_class c
--     cross join lateral aclexplode(c.relacl) a
--    where c.oid = 'public.organization_terms_acceptances'::regclass
--    order by 1, 2;
--
--   -- Q7. 実効権限（anon / authenticated はすべて false、service_role は sel・ins だけ true）
--   select r.role,
--          has_table_privilege(r.role, 'public.organization_terms_acceptances', 'SELECT')   as sel,
--          has_table_privilege(r.role, 'public.organization_terms_acceptances', 'INSERT')   as ins,
--          has_table_privilege(r.role, 'public.organization_terms_acceptances', 'UPDATE')   as upd,
--          has_table_privilege(r.role, 'public.organization_terms_acceptances', 'DELETE')   as del,
--          has_table_privilege(r.role, 'public.organization_terms_acceptances', 'TRUNCATE') as trunc
--     from (values ('anon'), ('authenticated'), ('service_role')) as r(role);
--
--   -- Q8. 関数が2本（consume_owner_invite と accept_owner_invite）・どちらも security definer・search_path 固定
--   select p.oid::regprocedure, p.prosecdef, p.proconfig, p.proowner::regrole, p.proacl
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname in ('consume_owner_invite', 'accept_owner_invite')
--    order by 1;
--
--   -- Q9. 関数の execute（service_role だけが true。2本とも）
--   select r.role,
--          has_function_privilege(r.role, 'public.consume_owner_invite(text, text)', 'EXECUTE')      as consume,
--          has_function_privilege(r.role, 'public.accept_owner_invite(text, text, text)', 'EXECUTE') as accept
--     from (values ('anon'), ('authenticated'), ('service_role')) as r(role);
--
--   -- Q10. 新しい関数の本文（このファイルの 3) と一致すること。記録として残す）
--   select pg_get_functiondef('public.accept_owner_invite(text, text, text)'::regprocedure);
--
--   -- Q11. トリガーが無いまま（どちらも0行が正）
--   select tgrelid::regclass, tgname from pg_trigger
--    where tgrelid in ('public.organization_members'::regclass,
--                      'public.organization_terms_acceptances'::regclass)
--      and not tgisinternal;
-- =========================================================
