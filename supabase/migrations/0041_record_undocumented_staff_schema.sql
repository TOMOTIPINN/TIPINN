-- 0041 — 実DBにあるが migration に記録されていない差分を「記録」する（追いつき migration）
-- 本番適用済み（2026-08-22・SQL Editor 手動）。全て if not exists のため本番では no-op だった。
-- 準拠: CLAUDE.md §3 / docs/40_decisions.md §1.3「作成」≠「適用」・§1.4「適用」≠「記録」・§6.1
--
-- 背景:
--   認証方式B（[[auth-method-line-b]]）のスタッフ招待〜LINE紐付けで使う staff の4カラムと、
--   その一意制約（部分 unique index 2本）が、**本番には存在するのに migration に無い**。
--   0018 / 0023 のコメントは line_user_id / invite_token の存在を前提に書かれており、
--   どこかの時点で SQL エディタから直接適用され、ファイルに書き戻されなかったと見られる
--   （＝§1.4「適用」≠「記録」の実例）。
--   このままだと、新環境（ステージング・災害復旧）を migrations から再構築したとき
--   スタッフ招待とスタッフログインが丸ごと動かない。
--
-- このファイルの性格:
--   **既存の本番に対しては全て no-op になることが期待値**（全て if not exists）。
--   実際の役割は「新環境で同じ形が再現できるようにする」ことと「記録を実態に一致させる」こと。
--
-- 不変条件（このファイルは絶対に破壊しない）:
--   ・drop / alter type / データ更新（update・delete）を**一切含めない**。
--   ・既存行は非破壊。追加カラムは全て nullable（既定値なし）。
--   ・RLS は 0001 の deny-by-default を変更しない。書き込みは service_role のみ。
--   ・line_user_id / invite_token は PII・秘匿値（原則7 / docs/50_security.md）。
--     このファイルはそれらを select も出力もしない。
--
-- 適用: Supabase SQL エディタで手動。`supabase db push` は使わない（§6.1）。


-- =========================================================
-- 1) staff の未記録カラム
--    実DB定義（2026-08-22 SQLエディタで確認）に一致させる。
--      line_user_id       … LINEログインの sub。1 LINE = 最大1 staff（下の 2) で強制）。
--                           customers.line_user_id とは別物（同じ人が両方に載りうる）。
--      invite_token       … 店長が発行する招待トークン（crypto.randomBytes(32).base64url）。
--                           紐付け成功時に null に戻す＝使い捨て（/api/staff/bind）。
--      invite_expires_at  … 発行から24h（@/lib/staff-invite の INVITE_TTL_MS）。
--      bound_at           … LINE紐付けが完了した時刻。
--    ⚠️ 4カラムとも nullable。not null にはできない:
--       ・招待前 / 紐付け前の行は line_user_id・bound_at が NULL
--       ・紐付け後の行は invite_token・invite_expires_at が NULL（消費済み）
--       ・0018 のアーカイブ（退職）でも触らない＝復帰時にそのまま戻す
-- =========================================================
alter table public.staff
  add column if not exists line_user_id      text,
  add column if not exists invite_token      text,
  add column if not exists invite_expires_at timestamptz,
  add column if not exists bound_at          timestamptz;


-- =========================================================
-- 2) staff の未記録インデックス（どちらも **部分** unique index）
--
--    ⚠️ where 句を落とさないこと。落とすと NULL 同士は衝突しない（NULLS DISTINCT）ので
--       一見動くが、意味が変わる。部分にしてあるのは意図的:
--         ・未招待 / 紐付け前の行が大量に NULL を持つのが正常系
--         ・0023 の staff_idempotency_key_key が **フル** unique なのは
--           supabase-js の upsert が WHERE 述語なしの ON CONFLICT を生成するため（0023 参照）。
--           こちらの2本は upsert 経路で使わないので部分でよい。
--
--    uq_staff_line_user_id が「1 LINE = 最大1 staff」の唯一の強制点。
--    @/lib/staff-session の resolveStaffByLineUserId が .eq("line_user_id", …) で
--    1行に解決できる前提そのもの＝アプリ側の分岐ではなく DB で担保している。
-- =========================================================
create unique index if not exists uq_staff_line_user_id
  on public.staff (line_user_id)
  where (line_user_id is not null);

create unique index if not exists uq_staff_invite_token
  on public.staff (invite_token)
  where (invite_token is not null);


-- =========================================================
-- 3) salons.notify_after_minutes の CHECK — **確認のみ・DDL は出さない**
--
--    不一致（2026-08-22 に決着済み。詳細と正式な記録は 0042 を読むこと）:
--      0014 は check (notify_after_minutes between 30 and 360) を張っているが、
--      本番の実際の定義は 10〜360 かつ 10の倍数:
--        CHECK ((((notify_after_minutes >= 10) AND (notify_after_minutes <= 360))
--                AND ((notify_after_minutes % 10) = 0)))
--      通知遅延UIを10分刻みにした際に SQL エディタで直接張り替えたもの。
--      → **本番が正。0014 の 30〜360 は破棄された値**（→ 0042 / docs/40_decisions.md §1.9）。
--
--    ここで直さない理由:
--      CHECK 制約は「作り直し」＝ drop してから add するしかなく、それは破壊的操作。
--      このファイルの不変条件（drop 禁止）に反する。
--      そもそも本番は既に正しい形なので、本番に対しては何もする必要がない。
--      新環境向けの張り替え SQL は 0042 の 2) にコメントとして置いてある。
--
--    よって下は読み取りだけを行い、現状を NOTICE に出す（0042 の assert と重複するが、
--    0041 単体を流したときにも現状が見えるように残す）。
-- =========================================================
do $$
declare
  v_def text;
  v_bad integer;
  v_min integer;
  v_max integer;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.salons'::regclass
    and conname  = 'salons_notify_after_minutes_check';

  -- 「正」＝10〜360 かつ 10の倍数。これを満たさない行を数える。
  select count(*) filter (
           where notify_after_minutes < 10
              or notify_after_minutes > 360
              or notify_after_minutes % 10 <> 0
         ),
         min(notify_after_minutes),
         max(notify_after_minutes)
    into v_bad, v_min, v_max
  from public.salons;

  if v_def is null then
    raise notice '[0041] salons_notify_after_minutes_check は存在しません（→ 0042 の 2) を検討）。';
  else
    raise notice '[0041] 現在の制約: %', v_def;
  end if;

  raise notice '[0041] notify_after_minutes の実データ: min=% max=% 正の範囲外=%件', v_min, v_max, v_bad;

  if v_bad > 0 then
    raise warning '[0041] ⚠️ 10〜360 かつ10の倍数を満たさない行があります。0042 を流す前に調べること。';
  end if;
end $$;


-- =========================================================
-- 4) 事後確認（読み取りのみ）
--    1) 2) が意図どおりの形になったかを NOTICE で出す。差異があれば手で確認する。
-- =========================================================
do $$
declare
  v_cols integer;
  v_line text;
  v_inv  text;
begin
  select count(*) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'staff'
    and column_name in ('line_user_id', 'invite_token', 'invite_expires_at', 'bound_at');

  if v_cols = 4 then
    raise notice '[0041] staff の4カラム: OK';
  else
    raise warning '[0041] staff の4カラムが揃っていません（% / 4）', v_cols;
  end if;

  select indexdef into v_line from pg_indexes
   where schemaname = 'public' and tablename = 'staff' and indexname = 'uq_staff_line_user_id';
  select indexdef into v_inv  from pg_indexes
   where schemaname = 'public' and tablename = 'staff' and indexname = 'uq_staff_invite_token';

  -- ⚠️ create index if not exists は「同名が既にあれば定義が違っても黙って skip」する。
  --    本番に別定義の同名 index が残っている可能性を潰すため、定義そのものを出して目視する。
  raise notice '[0041] uq_staff_line_user_id : %', coalesce(v_line, '(無し)');
  raise notice '[0041] uq_staff_invite_token : %', coalesce(v_inv,  '(無し)');
end $$;
