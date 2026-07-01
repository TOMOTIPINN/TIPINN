-- ============================================================================
-- echo — 営業デモ用サロンのシードデータ（本番Supabase / Supabase SQLエディタで手動実行）
-- ----------------------------------------------------------------------------
-- ★これは「データ」であって「スキーマ」ではない。migrations/ には置かない（scripts/ に置く）。
-- ★冪等: 固定UUID + ON CONFLICT で何度でも再実行できる（開くたび綺麗な状態に戻せる）。
-- ★固定UUIDは src/lib/demo.ts と同一（単一ソース）:
--     DEMO_SALON_ID          = deded000-0000-0000-0000-000000000000
--     persona customer(顧客) = deded001-0000-0000-0000-000000000000  (line: demo:customer:echo)
--     persona staff(店長)    = deded002-0000-0000-0000-000000000000  (line: demo:manager:echo)
-- ★命名規約（集計から除外できるように）:
--     salons.name        … 【DEMO】接頭辞  → name ILIKE '%DEMO%' で除外可
--     customers.display_name … （デモ）接頭辞
--     line_user_id       … demo: 接頭辞    → line_user_id LIKE 'demo:%' で除外可
--     salon_id = DEMO_SALON_ID でも全子データを一括除外できる
-- ★写真/ロゴは SQL では作れない（Supabase Storage のファイル）。ここでは NULL のまま入れ、
--   投入後に管理UI（A6 店舗プロフィール / A2 スタッフ編集）でアップロード＋位置調整する。
-- ★デモサロンは Stripe 未連携（stripe_account_id = NULL）。評価スタンプは下記で直接シードする
--   ため実決済は不要（実機で /rating の決済を試すと salon_not_onboarded になる。想定内）。
--
-- ‼️ 実行前チェック（別途これだけ先に流して true/列存在を確認）:
--     select column_name from information_schema.columns
--     where table_name='staff' and column_name in ('line_user_id','role');
--   → 2行返らなければ staff の認証列が未作成。seed は失敗（＝安全にロールバック）。先に列を用意。
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) salons（デモサロン 1件）
--    来店軸ON・cycle=20（実サービス既定と同条件）。19来店で 19/20＝「あと1回でVIP」。
--    ロゴは後から管理UIで。
-- ---------------------------------------------------------------------------
insert into public.salons (id, name, logo_url, stripe_account_id, visit_axis_enabled, visit_cycle_size)
values
  ('deded000-0000-0000-0000-000000000000', '【DEMO】echo デモサロン', null, null, true, 20)
on conflict (id) do update set
  name               = excluded.name,
  visit_axis_enabled = excluded.visit_axis_enabled,
  visit_cycle_size   = excluded.visit_cycle_size;

-- ---------------------------------------------------------------------------
-- 2) staff（4名：店長persona + スタイリスト2 + アシスタント1）
--    role: 'manager' は店長persona（ダッシュボード/店長Inbox）／他は 'staff'。
--    line_user_id: 店長のみ 'demo:manager:echo'（デモログインの as=staff が一致する）。
--    photo_url は NULL（頭文字フォールバック）。投入後に管理UIで写真アップ＋位置調整。
-- ---------------------------------------------------------------------------
insert into public.staff (id, salon_id, name, role, line_user_id, job_title, bio, photo_url)
values
  ('dededa01-0000-0000-0000-000000000000', 'deded000-0000-0000-0000-000000000000',
   '田中 みなと', 'manager', 'demo:manager:echo', '店長 / スタイリスト',
   'お客様の“なりたい”を一緒に描くのが好きです。何でもご相談ください。', null),
  ('dededa02-0000-0000-0000-000000000000', 'deded000-0000-0000-0000-000000000000',
   '佐藤 ゆい', 'staff', null, 'スタイリスト',
   'ショート・ボブが得意。骨格に合わせたカットを大切にしています。', null),
  ('dededa03-0000-0000-0000-000000000000', 'deded000-0000-0000-0000-000000000000',
   '鈴木 かな', 'staff', null, 'スタイリスト',
   'カラーとトリートメントが得意。艶感のある仕上がりを目指します。', null),
  ('dededa04-0000-0000-0000-000000000000', 'deded000-0000-0000-0000-000000000000',
   '高橋 りく', 'staff', null, 'アシスタント',
   'シャンプーと心地よい時間づくりを担当しています。よろしくお願いします。', null)
on conflict (id) do update set
  salon_id     = excluded.salon_id,
  name         = excluded.name,
  role         = excluded.role,
  line_user_id = excluded.line_user_id,
  job_title    = excluded.job_title,
  bio          = excluded.bio;

-- ---------------------------------------------------------------------------
-- 3) rewards（特典 2件・表示用 title のみ画面に出る）
-- ---------------------------------------------------------------------------
insert into public.rewards (id, salon_id, required_count, title, reward_type)
values
  ('dededc01-0000-0000-0000-000000000000', 'deded000-0000-0000-0000-000000000000',
   3, 'トリートメント1回サービス', 'service'),
  ('dededc02-0000-0000-0000-000000000000', 'deded000-0000-0000-0000-000000000000',
   6, '次回カラー10%OFF', 'discount')
on conflict (id) do update set
  required_count = excluded.required_count,
  title          = excluded.title,
  reward_type    = excluded.reward_type;

-- ---------------------------------------------------------------------------
-- 4) customers（デモ顧客 4名）
--    deded001 = マイページを映えさせる主役persona。
--    deded002 = 店長personaの顧客行（店長がmypageを開いても壊れないように）。
--    deded003 / deded004 = レビューの声を賑やかにする脇役。
-- ---------------------------------------------------------------------------
insert into public.customers (id, line_user_id, display_name)
values
  ('deded001-0000-0000-0000-000000000000', 'demo:customer:echo', '（デモ）花山 あかり'),
  ('deded002-0000-0000-0000-000000000000', 'demo:manager:echo',  '（デモ）田中 みなと'),
  ('deded003-0000-0000-0000-000000000000', 'demo:cust:a',        '（デモ）お客さま A'),
  ('deded004-0000-0000-0000-000000000000', 'demo:cust:b',        '（デモ）お客さま B')
on conflict (id) do update set
  line_user_id = excluded.line_user_id,
  display_name = excluded.display_name;

-- ---------------------------------------------------------------------------
-- 5) earned_stamps（感想軸スタンプ）
--    ※感想軸は来店軸(visit_cycle_size=20)とは別系統。コード側の CYCLE_SIZE=3 固定で回る
--      （salon 設定に依存しない）。よって cycle=20 化の影響を受けず count=8 のまま整合。
--    主persona deded001 の count=8 → CYCLE_SIZE=3基準で「特典2回獲得・累計8個・2/3」。
--    unique(customer_id,salon_id) で1行に集約。
-- ---------------------------------------------------------------------------
insert into public.earned_stamps (customer_id, salon_id, count)
values
  ('deded001-0000-0000-0000-000000000000', 'deded000-0000-0000-0000-000000000000', 8)
on conflict (customer_id, salon_id) do update set
  count      = excluded.count,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 6) visits（来店軸・主persona deded001 を 19回＝19/20＝「あと1回でVIP」）
--    unique(customer_id,salon_id,visited_on) で1日1行。
--    2026-02-15 から7日刻みの先頭19日を採用（固定日＝冪等・20日目に達しないので 19/20）。
-- ---------------------------------------------------------------------------
insert into public.visits (customer_id, salon_id, visited_on)
select
  'deded001-0000-0000-0000-000000000000',
  'deded000-0000-0000-0000-000000000000',
  d::date
from generate_series(date '2026-02-15', date '2026-06-28', interval '7 days') as g(d)
order by d
limit 19
on conflict (customer_id, salon_id, visited_on) do nothing;

-- ---------------------------------------------------------------------------
-- 7) reviews（無償の感想 12件）
--    スタッフ別に散らし、rating(1..4=改善..最高)・tags・share_scope を混在。
--    → スタッフホームの Team voices / 店長Inbox（everyone・manager_only）が埋まる。
--    固定UUID + ON CONFLICT(id) DO UPDATE で冪等。created_at は固定日で時系列を作る。
-- ---------------------------------------------------------------------------
insert into public.reviews (id, customer_id, salon_id, staff_id, body, rating, tags, share_scope, created_at)
values
  ('dededb01-0000-0000-0000-000000000000','deded001-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa01-0000-0000-0000-000000000000',
   'カウンセリングがとても丁寧で、なりたいイメージをしっかり汲み取ってくれました。仕上がりも大満足です。', 4, array['カウンセリング','仕上がり'], 'everyone',    timestamptz '2026-05-01 11:20+09'),
  ('dededb02-0000-0000-0000-000000000000','deded001-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa02-0000-0000-0000-000000000000',
   '初めてで緊張していましたが、会話が心地よくてリラックスできました。またお願いします。', 4, array['接客','居心地'], 'everyone',                          timestamptz '2026-05-08 15:05+09'),
  ('dededb03-0000-0000-0000-000000000000','deded003-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa03-0000-0000-0000-000000000000',
   'カラーの色持ちがよく、艶のある仕上がりで気に入っています。', 4, array['技術','仕上がり'], 'everyone',                                                   timestamptz '2026-05-12 13:40+09'),
  ('dededb04-0000-0000-0000-000000000000','deded004-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa04-0000-0000-0000-000000000000',
   'シャンプーが気持ちよくて、つい眠ってしまいました。気配りが素晴らしいです。', 4, array['居心地','挨拶'], 'everyone',                                     timestamptz '2026-05-18 17:10+09'),
  ('dededb05-0000-0000-0000-000000000000','deded001-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa02-0000-0000-0000-000000000000',
   '仕上がりはよかったのですが、少し待ち時間が長く感じました。次回に期待しています。', 2, array['受付'], 'manager_only',                                    timestamptz '2026-05-22 12:00+09'),
  ('dededb06-0000-0000-0000-000000000000','deded003-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa01-0000-0000-0000-000000000000',
   '毎回安定して素敵に仕上げてくれるので信頼しています。', 4, array['技術','仕上がり'], 'everyone',                                                         timestamptz '2026-05-28 10:30+09'),
  ('dededb07-0000-0000-0000-000000000000','deded004-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa03-0000-0000-0000-000000000000',
   '希望を伝えると具体的な提案をしてくれて、とても参考になりました。', 3, array['カウンセリング'], 'either',                                                 timestamptz '2026-06-02 14:25+09'),
  ('dededb08-0000-0000-0000-000000000000','deded001-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa01-0000-0000-0000-000000000000',
   '店内の雰囲気が落ち着いていて、居心地がとても良かったです。', 4, array['居心地'], 'everyone',                                                            timestamptz '2026-06-08 16:00+09'),
  ('dededb09-0000-0000-0000-000000000000','deded003-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa04-0000-0000-0000-000000000000',
   '受付から丁寧で、初めてでも安心して過ごせました。', 3, array['受付','挨拶'], 'everyone',                                                                 timestamptz '2026-06-14 11:45+09'),
  ('dededb10-0000-0000-0000-000000000000','deded001-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa03-0000-0000-0000-000000000000',
   'トリートメント後の手触りが全然違いました。おすすめです。', 4, array['技術','仕上がり'], 'everyone',                                                     timestamptz '2026-06-20 13:15+09'),
  ('dededb11-0000-0000-0000-000000000000','deded004-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa02-0000-0000-0000-000000000000',
   '普通に良かったです。次はカラーもお願いしてみたいです。', 3, array['技術'], 'either',                                                                    timestamptz '2026-06-25 15:30+09'),
  ('dededb12-0000-0000-0000-000000000000','deded001-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa01-0000-0000-0000-000000000000',
   '今日もありがとうございました。仕上がりが好きで通い続けています。', 4, array['仕上がり','挨拶'], 'everyone',                                              timestamptz '2026-06-28 12:50+09')
on conflict (id) do update set
  customer_id = excluded.customer_id,
  staff_id    = excluded.staff_id,
  body        = excluded.body,
  rating      = excluded.rating,
  tags        = excluded.tags,
  share_scope = excluded.share_scope,
  created_at  = excluded.created_at;

-- ---------------------------------------------------------------------------
-- 8) rating_purchases（有償の評価スタンプ 10件）
--    主persona deded001 の 6件 → マイページ「Your echoes sent」が充実（ティア散らし）。
--    脇役 deded003/004 の 4件 → 店舗合計/スタッフ別件数に厚み。
--    tier↔amount は CHECK 準拠: thank_you=100 / grateful=500 / wonderful=1000 /
--                               amazing=3000 / unforgettable=10000。
--    stripe_payment_id（unique）= 'demo_pi_*' で冪等（ON CONFLICT DO NOTHING）。
-- ---------------------------------------------------------------------------
insert into public.rating_purchases (customer_id, salon_id, staff_id, tier, amount, stripe_payment_id, created_at)
values
  -- 主persona（マイページ履歴用・6件）
  ('deded001-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa01-0000-0000-0000-000000000000','amazing',      3000,  'demo_pi_0001', timestamptz '2026-05-01 11:25+09'),
  ('deded001-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa02-0000-0000-0000-000000000000','grateful',      500,  'demo_pi_0002', timestamptz '2026-05-08 15:10+09'),
  ('deded001-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa03-0000-0000-0000-000000000000','wonderful',    1000,  'demo_pi_0003', timestamptz '2026-06-08 16:05+09'),
  ('deded001-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa01-0000-0000-0000-000000000000','thank_you',     100,  'demo_pi_0004', timestamptz '2026-06-20 13:20+09'),
  ('deded001-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa04-0000-0000-0000-000000000000','grateful',      500,  'demo_pi_0005', timestamptz '2026-06-22 18:00+09'),
  ('deded001-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa01-0000-0000-0000-000000000000','wonderful',    1000,  'demo_pi_0006', timestamptz '2026-06-28 12:55+09'),
  -- 脇役（件数の厚み・4件）
  ('deded003-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa03-0000-0000-0000-000000000000','wonderful',    1000,  'demo_pi_0007', timestamptz '2026-05-12 13:45+09'),
  ('deded003-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa01-0000-0000-0000-000000000000','amazing',      3000,  'demo_pi_0008', timestamptz '2026-05-28 10:35+09'),
  ('deded004-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa04-0000-0000-0000-000000000000','thank_you',     100,  'demo_pi_0009', timestamptz '2026-05-18 17:15+09'),
  ('deded004-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa02-0000-0000-0000-000000000000','unforgettable',10000, 'demo_pi_0010', timestamptz '2026-06-25 15:35+09')
on conflict (stripe_payment_id) do nothing;

commit;

-- ============================================================================
-- 巻き戻し（デモデータだけ削除）— 上とは別に、必要なときだけ実行する。
-- FK依存の逆順で消す（rating_purchases は customer/salon が on delete restrict のため先に）。
-- salon_id / line_user_id のデモ条件のみを対象にし、実データには触れない。
-- ----------------------------------------------------------------------------
-- begin;
--   delete from public.rating_purchases where salon_id = 'deded000-0000-0000-0000-000000000000';
--   delete from public.reviews          where salon_id = 'deded000-0000-0000-0000-000000000000';
--   delete from public.visits           where salon_id = 'deded000-0000-0000-0000-000000000000';
--   delete from public.earned_stamps    where salon_id = 'deded000-0000-0000-0000-000000000000';
--   delete from public.rewards          where salon_id = 'deded000-0000-0000-0000-000000000000';
--   delete from public.staff            where salon_id = 'deded000-0000-0000-0000-000000000000';
--   delete from public.customers        where line_user_id like 'demo:%';
--   delete from public.salons           where id = 'deded000-0000-0000-0000-000000000000';
-- commit;
-- ============================================================================
