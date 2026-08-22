-- 0042 — salons.notify_after_minutes は「10〜360 かつ 10の倍数」が正（0014 の 30〜360 は古い）
-- 本番適用済み（2026-08-22・SQL Editor 手動）。確認のみで DDL 無し。2) は未実行のまま。
-- 準拠: CLAUDE.md §3 / docs/40_decisions.md §1.3「作成」≠「適用」・§1.4「適用」≠「記録」・§6.1
--
-- 経緯（2026-08-22 に SQL エディタで確認）:
--   0014 は check (notify_after_minutes between 30 and 360) を張った。
--   その後、通知遅延の設定UIを10分刻みにするにあたり、**本番の制約を SQL エディタで直接
--   張り替えた**。migration に書き戻していないため 0014 の記録だけが古い。
--   実データ: min=10 / max=180 / 30分未満の行が1件（＝10 は実際に使われている）。
--
--   本番の実際の定義（2026-08-22 に全文確認・これが正）:
--     CHECK ((((notify_after_minutes >= 10) AND (notify_after_minutes <= 360))
--             AND ((notify_after_minutes % 10) = 0)))
--
--   → **10〜360 かつ 10の倍数** が正。0014 の 30〜360 は破棄された値である。
--   ⚠️ 第3項「10の倍数」を落とさないこと。範囲だけ合わせても等価にならない。
--      これは10分刻みUIの選択肢を DB 側で担保している項で、
--      between 10 and 360 と書くと 15 や 37 が通ってしまう。
--
-- ⚠️ このファイルは DDL を出さない（確認と記録のみ）。理由:
--   CHECK 制約の変更は drop → add でしか行えず、それは破壊的操作。
--   本番は既に 10〜360 なので**本番に対しては何もする必要がない**。
--   必要になるのは「migrations から作り直した新環境」だけで、そこでは 0014 が
--   30〜360 を張った直後の状態になる。その場合の手当ては下の【新環境向け】を
--   **人間が判断して手で流す**（コメントアウトのまま置いてあるので誤爆しない）。
--
-- 不変条件: drop / alter type / データ更新を一切含めない。既存行は非破壊。RLS 変更なし。
--
-- 適用: Supabase SQL エディタで手動。`supabase db push` は使わない（§6.1）。


-- =========================================================
-- 1) 現状の assert（読み取りのみ）
--
--    期待値は「10〜360 かつ 10の倍数」。ここで警告が出たら、下の【新環境向け】を流すか、
--    そもそも期待値の側が間違っている（＝この 0042 を直す）かのどちらか。
--
--    比較は空白を潰してから行う。pg_get_constraintdef の括弧・空白の入り方は
--    PostgreSQL のバージョンで変わりうるため、生の文字列等価だと誤検知しやすい。
-- =========================================================
do $$
declare
  v_def      text;
  v_norm     text;
  v_expected text :=
    'CHECK ((((notify_after_minutes >= 10) AND (notify_after_minutes <= 360))'
    || ' AND ((notify_after_minutes % 10) = 0)))';
  v_min      integer;
  v_max      integer;
  v_out      integer;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.salons'::regclass
    and conname  = 'salons_notify_after_minutes_check';

  -- 改行・連続空白を単一スペースに潰す（表示の折り返しやバージョン差を吸収）。
  v_norm := btrim(regexp_replace(coalesce(v_def, ''), '\s+', ' ', 'g'));

  if v_def is null then
    raise warning '[0042] salons_notify_after_minutes_check が存在しません。下の【新環境向け】の add を流してください。';
  elsif v_norm = btrim(regexp_replace(v_expected, '\s+', ' ', 'g')) then
    raise notice '[0042] 制約は期待どおり（10〜360 かつ 10の倍数）です: %', v_def;
  else
    -- ここに来る＝記録(このファイル)と実態がまだズレている。**このファイルの側を直す**のが原則。
    raise warning '[0042] 制約が期待値と違います。実際: % / 期待: %', v_def, v_expected;
  end if;

  -- 範囲外の判定にも「10の倍数」を含める（張り替え前の前提確認なので制約と同じ条件で数える）。
  select min(notify_after_minutes), max(notify_after_minutes),
         count(*) filter (
           where notify_after_minutes < 10
              or notify_after_minutes > 360
              or notify_after_minutes % 10 <> 0
         )
    into v_min, v_max, v_out
  from public.salons;

  raise notice '[0042] 実データ: min=% max=% 制約を満たさない行=%件', v_min, v_max, v_out;

  if v_out > 0 then
    raise warning '[0042] ⚠️ 10〜360 かつ10の倍数を満たさない行があります。制約を張る前に必ず調べること。';
  end if;
end $$;


-- =========================================================
-- 2) 【新環境向け・手動実行】0014 の 30〜360 を「10〜360 かつ 10の倍数」に張り替える SQL
--
--    ⚠️ **コメントアウトしたまま置いてある。自動では流れない。**
--       既存の本番では不要（既に 10〜360）。migrations から作り直した環境でだけ、
--       上の 1) が警告を出したときに、内容を理解した上で手で外して流す。
--
--    ⚠️ drop を含む＝破壊的操作。流す前に必ず:
--       ・1) の NOTICE で「制約を満たさない行=0件」であることを確認する
--         （満たさない行があると add constraint が失敗し、drop だけ通って**無防備な状態で残る**）
--       ・drop と add を必ず**同じトランザクションで**流す（begin; … commit;）
--       ・SQL エディタは新しいタブで開く（docs/40_decisions.md §1.5）
--
--    ⚠️ 第3項「% 10 = 0」を消さないこと。between だけにすると 15 や 37 が通り、
--       10分刻みUIの前提が DB 側から外れる（本番はこの3項で運用されている）。
--
--    begin;
--
--    alter table public.salons
--      drop constraint if exists salons_notify_after_minutes_check;
--
--    alter table public.salons
--      add  constraint salons_notify_after_minutes_check
--      check (
--        notify_after_minutes >= 10
--        and notify_after_minutes <= 360
--        and notify_after_minutes % 10 = 0
--      );
--
--    commit;
--
--    流した後は 0042 を再実行し、1) が NOTICE（警告なし）になることを確認する。
-- =========================================================
