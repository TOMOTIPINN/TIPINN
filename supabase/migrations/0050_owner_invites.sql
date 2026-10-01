-- ⚠️ 適用済み（2026-10-01 13:44 頃、SQL エディタで手動適用）・再実行しない
--    ★レビュー前に適用された★ 事後にレビューし修正不要と判断（40_decisions.md §1.13）。
--    適用後の確認済み: ガード1・ガード2 が通った（Success）＝本番で RLS 有効・ポリシー0件・
--    anon/authenticated の権限なし・関数1本・execute は service_role のみ /
--    同じファイルを再度 Run するとガード1「owner_invites が既に存在する」で中断（変更なし・
--    貼られたのがこのファイルである傍証）/
--    organization_members は role = CHECK (role = 'owner')・unique 制約名
--    organization_members_line_user_id_key・必須列は org_id と line_user_id のみ
--    （id / role / created_at は既定値あり）＝関数の INSERT と一致。
--    **関数を実際に呼んだ確認はまだ**（5e で確認する）。
--
-- 0050_owner_invites.sql
-- §21 コミット5a — オーナー招待（方式 P）のテーブルと、消費＋オーナー登録の RPC。
--
-- 経緯（docs/40_decisions.md §21「2026-09-24 決定（コミット5 オーナー招待）」）:
--   ・方式 P: 運営者が**先に組織を作り**、オーナー招待は**その組織を指す**（発行時に org_id が決まる）。
--   ・オーナー招待を使った人は、スタッフ行の有無に関係なく /owner が開く（決定2）。
--   ・入口の判定順は レート制限 → ログイン → コードの確認 → すでにオーナーか → 書き込み（決定3）。
--     レート制限とログインはアプリ側（5e）。この RPC は「コードの確認」以降を受け持つ。
--   ・**書き込みは RPC にする**（決定4）。アプリからオーナー権限を与える初めての経路なので、
--     「招待は使用済みなのにメンバー行が無い」等の中途半端な状態を構造的に残さない。
--   ・有効期限は14日（決定5・salon_invites と同じ。値はアプリ側で入れる）。
--   ・audit_log には載せない（決定6）。
--
-- 設計の要点:
--   ・列は salon_invites（0043）に揃える。違いは「消費して何ができたか」の列だけ
--     （salon_id → used_member_id）と、発行時に必須の org_id。
--   ・★0043 の「used_at と salon_id の両方 null か両方あり」の CHECK は写さない★
--     used_member_id は on delete set null。両方向の CHECK と同時に使うと、消費済みの
--     招待が指すメンバー行を消したときに set null が CHECK 違反になり、削除そのものが失敗する
--     （§21「計画で出したが、まだ決めていないもの」の注意）。
--     → CHECK は片方向（used_member_id があれば used_at もある）だけにする。
--       「used_at あり・used_member_id null」は「消費後にメンバー行が消えた」を意味する。
--   ・消費は RPC の中で、行を `for update` で押さえてから条件付き UPDATE する。
--     同じコードを同時に2人が使っても、2人目は1人目の確定を待ってから「used」になる。
--
-- この migration がやらないこと（意図的）:
--   ・**organization_members にトリガーを付けない**（決定6。付けると line_user_id が
--     audit_log.new_data に入り、70_legal.md §5 補足の前提が崩れる）。
--   ・organization_members・organizations・salons・salon_invites の定義には触らない。
--   ・0043 末尾の「使い方（salon_invites の契約）」は変えない。
--   ・既存の RPC・既定の権限付与（pg_default_acl）には触らない。
--   ・データは入れない（招待の発行は 5d のアプリから）。
--
-- ★トランザクション★
--   Supabase の SQL エディタはスクリプト全体を1トランザクションで実行する（0047〜0049 と同じ）。
--   下の begin/commit はそれを明示するためのもので、エディタが既にトランザクションを
--   開いている場合 begin は「there is already a transaction in progress」の **WARNING** を
--   出すが、エラーにはならない。どこかの raise exception で全体が巻き戻る。

begin;


-- =========================================================
-- ガード 1) 同じ名前のテーブル・関数がまだ無いこと／前提の制約名が本番どおりであること
--
--   `create table if not exists` にすると、想定と違う owner_invites が既にあったとき
--   **黙って素通り**してしまう。ここでは止める。
--   制約名は RPC の例外処理（unique 違反の判定）が名前で見ているため、
--   本番の名前が違えば RPC が already_owner を返せない。適用前に落とす。
-- =========================================================
do $$
begin
  if to_regclass('public.owner_invites') is not null then
    raise exception '[0050] public.owner_invites が既に存在する。中断する';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'consume_owner_invite'
  ) then
    raise exception '[0050] public.consume_owner_invite が既に存在する。中断する';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.organization_members'::regclass
       and conname  = 'organization_members_line_user_id_key'
       and contype  = 'u'
  ) then
    raise exception '[0050] organization_members_line_user_id_key（unique(line_user_id)）が見つからない。中断する';
  end if;

  if exists (
    select 1 from pg_trigger
     where tgrelid = 'public.organization_members'::regclass
       and not tgisinternal
  ) then
    raise exception '[0050] organization_members にトリガーがある（決定6 の前提と違う）。中断する';
  end if;

  raise notice '[0050] ガード1 OK: owner_invites・consume_owner_invite は未作成／unique 制約あり／トリガーなし';
end $$;


-- =========================================================
-- 1) owner_invites
-- =========================================================
create table public.owner_invites (
  id                      uuid        primary key default gen_random_uuid(),
  -- 招待コード。salon_invites と同じ Crockford Base32 の12桁を正規化して保存する（ハイフン無し）。
  code                    text        not null unique,
  -- この招待で登録されるオーナーの組織。発行時に必須（方式 P）。
  -- on delete restrict: 招待の履歴が組織の削除を止める（salon_invites.org_id と同じ）。
  org_id                  uuid        not null references public.organizations(id) on delete restrict,
  -- 宛先メール。**メモ用途**（このテーブルからメールは送らない）。未定でも発行できる。
  recipient_email         text,
  -- 運営者が「送った」と手でチェックした時刻。null = 未送信。
  sent_at                 timestamptz,
  created_at              timestamptz not null default now(),
  -- 発行から14日（アプリ側で now()+14d を入れる）。
  expires_at              timestamptz not null,
  -- 消費時刻。null = 未使用。
  used_at                 timestamptz,
  -- 消費して作られた organization_members の行。メンバー行が消えても招待の履歴は残す（set null）。
  used_member_id          uuid        references public.organization_members(id) on delete set null,
  -- 誰が発行したか（運営者が複数になったときの監査用）。PII なので admin 経路以外に出さない。
  created_by_line_user_id text,

  -- 片方向だけ: used_member_id があれば used_at もある。
  -- 逆向き（used_at があれば used_member_id もある）は付けない。付けると set null で削除が失敗する。
  constraint owner_invites_member_requires_used
    check (used_member_id is null or used_at is not null)
);

-- 1メンバー = 最大1招待。同じメンバー行に2つの招待が付いた事故を DB で検出できるようにする
-- （uq_salon_invites_salon_id と同じ）。
create unique index uq_owner_invites_used_member_id
  on public.owner_invites (used_member_id)
  where (used_member_id is not null);

-- 一覧（5d）は発行日の新しい順。
create index owner_invites_created_idx
  on public.owner_invites (created_at desc);

-- 組織ごとの招待を引く（5b/5d の組織画面）。
create index owner_invites_org_id_idx
  on public.owner_invites (org_id);

-- RLS: ポリシーを1本も定義しない＝完全 deny（0037 / 0043 / 0048 と同じ作法）。
-- 招待コードは「持っていればオーナーになれる」秘密値なので、service_role 以外に読ませない。
-- ※ 0031 の event trigger が RLS を自動 enable するが、明示的にも書いておく。
alter table public.owner_invites enable row level security;

-- service_role の権限（0043 / 0048 と同じ構図。uuid 主キーなのでシーケンスの grant は不要）。
grant select, insert, update on table public.owner_invites to service_role;


-- =========================================================
-- 2) consume_owner_invite — 招待の消費とオーナー登録を1つの関数で行う
--
--   引数: p_code = 正規化済みのコード（アプリ側の normalizeInviteCode を通したもの）
--         p_line_user_id = サーバーのセッション由来の LINE user id（クライアントから受け取らない）
--   戻り値: 1行。status と joined_org_id。
--     status = 'ok'            → joined_org_id にオーナーになった組織
--              'invalid_input' → 引数が null / 空
--              'not_found'     → そのコードの招待が無い
--              'used'          → 使用済み
--              'expired'       → 期限切れ
--              'already_owner' → すでにどこかの組織のオーナー（同時に2本使われた場合も含む）
--     失敗のときは joined_org_id = null。**例外では終わらせない**（想定外のエラーだけ raise）。
--
--   判定の順（決定3）: コードの確認 → すでにオーナーか → 書き込み。
--     コードを先に見るので、すでにオーナーの原のアカウントでも not_found / used / expired に到達できる。
--
--   同時実行:
--     ・同じコードを2人が同時に使う → `for update` で2人目が待ち、1人目の確定後に used を返す。
--     ・同じ人が別の2本を同時に使う → どちらも「まだオーナーでない」を通り抜けうるが、
--       organization_members の unique(line_user_id) で2本目の INSERT が落ちる。
--       その unique 違反を内側のブロックで受けて already_owner を返す。内側のブロックは
--       savepoint なので、**2本目の招待の消費も一緒に巻き戻り、未使用のまま残る**。
--
--   search_path は既存の RPC（0033 / 0038 / 0046）と同じ `public` に固定し、
--   本文のテーブルもすべて `public.` で修飾する。
-- =========================================================
create function public.consume_owner_invite(
  p_code         text,
  p_line_user_id text
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
     or p_line_user_id is null or btrim(p_line_user_id) = '' then
    status := 'invalid_input'; joined_org_id := null;
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

  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      -- 同じ人が別の招待を同時に使い、先に登録された場合だけ already_owner に畳む。
      -- それ以外の unique 違反（想定外）は握りつぶさずに上げる。
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

-- 呼べるのは service_role だけ。
-- 0038 で public, anon, authenticated から revoke した際に service_role の execute も
-- 外れて呼べなくなった（0040 で修正）ので、grant も同じ migration に書く。
revoke all on function public.consume_owner_invite(text, text) from public, anon, authenticated;
grant execute on function public.consume_owner_invite(text, text) to service_role;


-- =========================================================
-- ガード 2) 適用結果の確認（落ちたら全体が巻き戻る）
--
--   ・owner_invites が RLS 有効・ポリシー0件
--   ・owner_invites の ACL に anon / authenticated が無い（0049 の既定の権限付与が効いているか）
--   ・関数が1本だけで、anon / authenticated / PUBLIC から実行できない・service_role は実行できる
-- =========================================================
do $$
declare
  v_rls      boolean;
  v_policies int;
  v_acl_rows int;
  v_funcs    int;
begin
  select c.relrowsecurity into v_rls
    from pg_class c where c.oid = 'public.owner_invites'::regclass;
  select count(*) into v_policies
    from pg_policies where schemaname = 'public' and tablename = 'owner_invites';
  if not v_rls or v_policies <> 0 then
    raise exception '[0050] owner_invites の RLS が想定と違う（rls=% / policies=%）。中断する', v_rls, v_policies;
  end if;

  select count(*) into v_acl_rows
    from pg_class c
    cross join lateral aclexplode(c.relacl) a
   where c.oid = 'public.owner_invites'::regclass
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'));
  if v_acl_rows <> 0 then
    raise exception '[0050] owner_invites に anon / authenticated / PUBLIC の権限が % 件ある。中断する', v_acl_rows;
  end if;

  select count(*) into v_funcs
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'consume_owner_invite';
  if v_funcs <> 1 then
    raise exception '[0050] consume_owner_invite が % 本ある（1本が正）。中断する', v_funcs;
  end if;

  if has_function_privilege('anon',          'public.consume_owner_invite(text, text)', 'EXECUTE')
  or has_function_privilege('authenticated', 'public.consume_owner_invite(text, text)', 'EXECUTE') then
    raise exception '[0050] consume_owner_invite を anon / authenticated が実行できる。中断する';
  end if;

  if not has_function_privilege('service_role', 'public.consume_owner_invite(text, text)', 'EXECUTE') then
    raise exception '[0050] consume_owner_invite を service_role が実行できない（0038→0040 と同じ事故）。中断する';
  end if;

  raise notice '[0050] ガード2 OK: RLS 有効・ポリシー0件・anon/authenticated の権限なし・関数1本・execute は service_role のみ';
end $$;


-- テーブルと関数を追加したので PostgREST のスキーマキャッシュをリロード（0048 と同じ）。
notify pgrst, 'reload schema';

commit;


-- =========================================================
-- 適用後の確認クエリ（SQL エディタで別途実行して目視すること）
--
--   -- テーブルの列（10列: id / code / org_id / recipient_email / sent_at / created_at /
--   --   expires_at / used_at / used_member_id / created_by_line_user_id）
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'owner_invites'
--    order by ordinal_position;
--
--   -- FK の on delete（org_id = RESTRICT / used_member_id = SET NULL）と CHECK
--   select conname, contype, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.owner_invites'::regclass
--    order by contype, conname;
--
--   -- RLS 有効・ポリシー0件
--   select c.relname, c.relrowsecurity,
--          (select count(*) from pg_policies p
--            where p.schemaname = 'public' and p.tablename = c.relname) as policies
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname = 'owner_invites';
--
--   -- テーブルの ACL（anon / authenticated / PUBLIC の行が無いのが正。service_role の行は出てよい）
--   select coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') as grantee, a.privilege_type
--     from pg_class c
--     cross join lateral aclexplode(c.relacl) a
--    where c.oid = 'public.owner_invites'::regclass
--    order by 1, 2;
--
--   -- 実効権限（継承・PUBLIC 込み。false が並ぶのが正）
--   select r.role,
--          has_table_privilege(r.role, 'public.owner_invites', 'SELECT')   as sel,
--          has_table_privilege(r.role, 'public.owner_invites', 'INSERT')   as ins,
--          has_table_privilege(r.role, 'public.owner_invites', 'UPDATE')   as upd,
--          has_table_privilege(r.role, 'public.owner_invites', 'DELETE')   as del,
--          has_table_privilege(r.role, 'public.owner_invites', 'TRUNCATE') as trunc
--     from (values ('anon'), ('authenticated')) as r(role);
--
--   -- 関数が1本だけ・security definer・search_path 固定
--   select p.oid::regprocedure, p.prosecdef, p.proconfig, p.proowner::regrole
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'consume_owner_invite';
--
--   -- 関数の execute（service_role だけが true）
--   select r.role,
--          has_function_privilege(r.role, 'public.consume_owner_invite(text, text)', 'EXECUTE') as can_execute
--     from (values ('anon'), ('authenticated'), ('service_role')) as r(role);
--
--   -- organization_members にトリガーが無いまま（0行が正・決定6）
--   select tgname from pg_trigger
--    where tgrelid = 'public.organization_members'::regclass and not tgisinternal;
-- =========================================================
