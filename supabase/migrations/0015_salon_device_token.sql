-- 0015 — 受付端末（キオスク）トークン / device_token
-- 準拠: CLAUDE.md §2 絶対原則 / §4 データモデル・RLS / [[auth-method-line-b]]
--
-- 目的:
--   各店のiPadを常設受付端末にするための「店の端末トークン」を salons に持たせる。
--   ・推測不能なUUID（crypto.randomUUID を manager が発行）。null許容＝後から発行/未発行。
--   ・端末は device_token → salon_id に紐付く。その端末の来店記録は必ずその店（越境不可）。
--   ・漏洩時は manager が再発行（UPDATE で上書き）→ 旧トークンは即無効（cookie側は毎回DB再照合）。
--
-- 据え置き記録の匿名性:
--   visits(0009) は元々 staff_id 列を持たない＝来店記録は常に匿名。端末経路でも staff_id は残さない。
--   よってこの migration はカラム追加のみ（visits・RPCは無改修）。
--
-- 方針（0009/0014 と同じ作法）:
--   ・列追加は add column if not exists。索引は create ... if not exists で冪等。
--   ・RLS は deny-by-default（0001）を維持＝salons は service_role のみアクセス（ポリシー追加なし）。
--   ・適用は Supabase SQLエディタで手動（CLAUDE.md §3・`supabase db push` は使わない）。

alter table public.salons
  add column if not exists device_token text;   -- 推測不能UUID・null許容・後から発行

-- 一意照合＆衝突防止（null は複数許容＝未発行の店が併存できる部分ユニーク索引）。
create unique index if not exists salons_device_token_key
  on public.salons(device_token)
  where device_token is not null;
