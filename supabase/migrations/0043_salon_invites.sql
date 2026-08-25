-- ⚠️ 本番適用済み（2026-08-25・SQL Editor 手動）・再実行しない
-- 適用後の確認済み: salon_invites 9列 / RLS = true / ポリシー0件。
-- 0043_salon_invites.sql
-- サロン作成を招待制にする。/manager/salon/new は LINE ログインさえ通れば
-- 誰でもサロンを作れる状態だった（docs/access-control-audit.md §54 で「意図的」と
-- 記録されていた入口）。ここに「有効な招待コード」を必須にして塞ぐ。
--
-- 設計の要点:
--   ・招待の消費は **条件付き UPDATE の更新行数**で判定する（下の使い方を参照）。
--     SELECT で確認 → UPDATE の2段にすると、同じコードで同時に2サロン作れる。
--   ・used_at と salon_id は必ず同時に埋まる（CHECK で担保）。
--   ・1サロン = 最大1招待（uq_salon_invites_salon_id）。1つの招待から2サロンは作れない。
--   ・staff.role には一切触らない。運営者判定は env ADMIN_LINE_USER_IDS のみ（DB に持たない）。
--
-- 既存データへの影響: なし（新規テーブルのみ。salons / staff は変更しない）。
--   既存の CARTA / Niii / nun / テストサロン / DEMO は invites に行を持たないが、
--   招待の検査は「これから作るサロン」にしか走らないため影響しない。

create table if not exists public.salon_invites (
  id                      uuid        primary key default gen_random_uuid(),
  -- 招待コード。Crockford Base32（I/L/O/U を除く32文字）の12桁を正規化して保存する。
  -- 表示は 4文字ずつハイフン区切り（XXXX-XXXX-XXXX）だが、DB にはハイフン無しで入れる。
  code                    text        not null unique,
  -- 宛先メール。**メモ用途**（このテーブルからメールは送らない）。未定でも発行できる。
  recipient_email         text,
  -- 運営者が「送った」と手でチェックした時刻。null = 未送信。
  sent_at                 timestamptz,
  created_at              timestamptz not null default now(),
  -- 発行から14日（アプリ側で now()+14d を入れる。復旧すると now()+14d に延長される）。
  expires_at              timestamptz not null,
  -- 消費時刻。null = 未使用。
  used_at                 timestamptz,
  -- 消費して作られたサロン。サロンが消えても招待の履歴は残す（set null）。
  salon_id                uuid        references public.salons(id) on delete set null,
  -- 誰が発行したか（運営者が複数になったときの監査用）。PII なので admin 経路以外に出さない。
  created_by_line_user_id text,

  -- used_at と salon_id は必ずセット。片方だけ埋まった中途半端な行を作らせない。
  constraint salon_invites_used_pair
    check ((used_at is null) = (salon_id is null))
);

-- 1サロン = 最大1招待。同じ招待から2サロンが生えた事故を DB で検出できるようにする。
create unique index if not exists uq_salon_invites_salon_id
  on public.salon_invites (salon_id)
  where (salon_id is not null);

-- 一覧（/admin/invites）は発行日の新しい順。
create index if not exists salon_invites_created_idx
  on public.salon_invites (created_at desc);

-- RLS: ポリシーを1本も定義しない＝完全 deny（意図的・login_attempts 0037 と同じ作法）。
-- 招待コードは「持っていればサロンを作れる」秘密値なので、service_role 以外に読ませない。
-- ※ 0031 の event trigger が public への create table で RLS を自動 enable するが、
--    明示的にも書いておく（trigger が外れた環境でも守られるように）。
alter table public.salon_invites enable row level security;

-- service_role の権限（0039 と同じ構図。uuid 主キーなのでシーケンスの grant は不要）。
grant select, insert, update on table public.salon_invites to service_role;


-- =========================================================
-- 使い方（アプリ側の契約・変更しないこと）
--
-- 1) 検証（表示用の事前チェック。ここだけでは消費しない）:
--      select id, used_at, expires_at from public.salon_invites where code = $1;
--
-- 2) 消費（**原子的**。salons へ INSERT し終えた後に実行する）:
--      update public.salon_invites
--         set used_at = now(), salon_id = $2
--       where code = $1
--         and used_at is null
--         and expires_at > now()
--      returning id;
--
--    → 戻り行が0件なら「他のリクエストに先を越された / 期限切れ / 使用済み」。
--      その場合は直前に作った salon と staff を消してロールバックする。
--
--    salon_id が FK で salons を参照しているため、**消費は salons INSERT より後**に
--    しか実行できない（順序を入れ替えると FK 違反になる）。
--
-- 3) 復旧（/admin/invites の「復旧」）:
--      update public.salon_invites
--         set expires_at = now() + interval '14 days'
--       where id = $1 and used_at is null;
--
--    使用済みの招待は復旧しない（used_at is null を必ず付ける）。
-- =========================================================
