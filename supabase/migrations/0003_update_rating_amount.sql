-- 0003 — 評価スタンプ価格の最終確定
-- 旧: amount in (100, 300, 500, 1000, 10000)
-- 新: amount in (100, 500, 1500, 3000, 10000)
--
-- 準拠: CLAUDE.md「1.絶対原則」
--   ・価格はecho側で固定。サロンは変更不可（この CHECK制約が DB側の最後の砦）。
--   ・RLSは deny-by-default（0001の方針）を一切変更しない。
--   ・amount は記録用（残高ではない・原則5）。金額はすべて税込（消費税額 = amount × 10/110）。
--
-- tier↔amount↔ラベルの対応（tierラベルは0001から不変。新価格を割当）:
--   thank_you=¥100 / grateful=¥500 / wonderful=¥1,500 / amazing=¥3,000 / unforgettable=¥10,000
--   (Thank you / Grateful / Wonderful / Amazing / Unforgettable)
-- ※ tier の CHECK（ラベル集合）は不変のため変更しない。

-- 1) amount の許容値を新価格へ差し替え
--    （0001 のインライン無名CHECKは Postgres が rating_purchases_amount_check と自動命名する）
alter table public.rating_purchases
  drop constraint if exists rating_purchases_amount_check;

alter table public.rating_purchases
  add  constraint rating_purchases_amount_check
  check (amount in (100, 500, 1500, 3000, 10000));

-- 2) tier↔amount の対応を DB側でも固定（「価格はecho側で固定」を完全保証）
--    不整合な組み合わせ（例: tier=thank_you なのに amount=10000）を物理的に拒否する。
alter table public.rating_purchases
  drop constraint if exists rating_purchases_tier_amount_check;

alter table public.rating_purchases
  add  constraint rating_purchases_tier_amount_check
  check (
    (tier = 'thank_you'     and amount = 100)   or
    (tier = 'grateful'      and amount = 500)   or
    (tier = 'wonderful'     and amount = 1500)  or
    (tier = 'amazing'       and amount = 3000)  or
    (tier = 'unforgettable' and amount = 10000)
  );
