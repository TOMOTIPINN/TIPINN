-- 0005 — 評価スタンプ価格の改定: Wonderful のみ ¥1,500 → ¥1,000
-- 他ティア（Thank you / Grateful / Amazing / Unforgettable）は変更なし。
--
-- 準拠: CLAUDE.md 原則8（価格は echo 側で固定。サロンは変更不可＝この CHECK が DB側の最後の砦）。
--   ・amount は記録用（残高ではない・原則5）。金額はすべて税込（消費税額 = amount × 10/110）。
--   ・RLS deny-by-default（0001の方針）は一切変更しない。
--   ・tier の CHECK（ラベル集合 = rating_purchases_tier_check）は slug 不変のため変更しない。
--
-- 旧: amount in (100, 500, 1500, 3000, 10000) / wonderful = 1500
-- 新: amount in (100, 500, 1000, 3000, 10000) / wonderful = 1000
--
-- ★順序の注意★
--   旧 amount_check は 1000 を許可しないため、制約が残ったまま update すると弾かれる。
--   よって「両制約を drop → 既存テストデータを update → 制約を再作成」の順で行う（1トランザクション）。

begin;

-- 1) 旧制約を先に外す（update を通すため・tier↔amount も 1500 を要求するので両方落とす）
alter table public.rating_purchases
  drop constraint if exists rating_purchases_tier_amount_check;

alter table public.rating_purchases
  drop constraint if exists rating_purchases_amount_check;

-- 2) 既存テストデータの是正（旧価格 1500 の wonderful を新価格 1000 へ）
--    1500 のまま残っていると下の新 CHECK 追加時に弾かれる。テストデータのため update で可。
update public.rating_purchases
  set amount = 1000
  where tier = 'wonderful' and amount = 1500;

-- 3) amount の許容値: 1500 → 1000
alter table public.rating_purchases
  add  constraint rating_purchases_amount_check
  check (amount in (100, 500, 1000, 3000, 10000));

-- 4) tier↔amount の対応: (wonderful, 1500) → (wonderful, 1000)
--    不整合な組み合わせ（例: tier=wonderful なのに amount=1500）を物理的に拒否する。
alter table public.rating_purchases
  add  constraint rating_purchases_tier_amount_check
  check (
    (tier = 'thank_you'     and amount = 100)   or
    (tier = 'grateful'      and amount = 500)   or
    (tier = 'wonderful'     and amount = 1000)  or
    (tier = 'amazing'       and amount = 3000)  or
    (tier = 'unforgettable' and amount = 10000)
  );

commit;
