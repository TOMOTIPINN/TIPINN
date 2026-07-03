-- ============================================================================
-- echo — 営業デモ用サロンのシードデータ（本番Supabase / Supabase SQLエディタで手動実行）
-- ----------------------------------------------------------------------------
-- ★これは「データ」であって「スキーマ」ではない。migrations/ には置かない（scripts/ に置く）。
-- ★冪等: 固定UUID + ON CONFLICT で何度でも再実行できる（開くたび綺麗な状態に戻せる）。
-- ★固定UUIDは src/lib/demo.ts と同一（単一ソース）:
--     DEMO_SALON_ID          = deded000-0000-0000-0000-000000000000
--     persona customer(顧客)     = deded001-0000-0000-0000-000000000000  (line: demo:customer:echo)
--     persona staff(一般スタッフ) = deded005-0000-0000-0000-000000000000  (line: demo:staff:echo → staff dededa02)
--     persona manager(店長)       = deded002-0000-0000-0000-000000000000  (line: demo:manager:echo → staff dededa01)
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
--    line_user_id: 店長=田中 'demo:manager:echo'（as=manager が一致）／
--                  一般スタッフ=佐藤 'demo:staff:echo'（as=staff が一致）。他2名は NULL。
--    photo_url は NULL（頭文字フォールバック）。投入後に管理UIで写真アップ＋位置調整。
-- ---------------------------------------------------------------------------
insert into public.staff (id, salon_id, name, role, line_user_id, job_title, bio, photo_url)
values
  ('dededa01-0000-0000-0000-000000000000', 'deded000-0000-0000-0000-000000000000',
   '田中 みなと', 'manager', 'demo:manager:echo', '店長 / スタイリスト',
   'お客様の“なりたい”を一緒に描くのが好きです。何でもご相談ください。', null),
  ('dededa02-0000-0000-0000-000000000000', 'deded000-0000-0000-0000-000000000000',
   '佐藤 ゆい', 'staff', 'demo:staff:echo', 'スタイリスト',
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
--    deded005 = 一般スタッフpersonaの顧客保険行（スタッフがmypageを開いても壊れないように）。
--    deded003 / deded004 = レビューの声を賑やかにする脇役。
-- ---------------------------------------------------------------------------
insert into public.customers (id, line_user_id, display_name)
values
  ('deded001-0000-0000-0000-000000000000', 'demo:customer:echo', '（デモ）花山 あかり'),
  ('deded002-0000-0000-0000-000000000000', 'demo:manager:echo',  '（デモ）田中 みなと'),
  ('deded005-0000-0000-0000-000000000000', 'demo:staff:echo',    '（デモ）佐藤 ゆい'),
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
--    unique(customer_id,salon_id,visited_on) で1日1行。件数(=19)だけが来店ゲージに効く。
--    seed 実行時の「今日(JST)から遡る直近19日」を採用＝毎回 recent な当月寄りの日付になる。
--    ★visited_on は相対日で安定キーが無いため、再seed 時に増殖しないよう先に当該デモ行を削除する
--      （salon=DEMO かつ customer=主persona に限定＝実データには当たらない）。
-- ---------------------------------------------------------------------------
delete from public.visits
where salon_id = 'deded000-0000-0000-0000-000000000000'
  and customer_id = 'deded001-0000-0000-0000-000000000000';

insert into public.visits (customer_id, salon_id, visited_on)
select
  'deded001-0000-0000-0000-000000000000',
  'deded000-0000-0000-0000-000000000000',
  (now() at time zone 'Asia/Tokyo')::date - g
from generate_series(0, 18) as s(g)
on conflict (customer_id, salon_id, visited_on) do nothing;

-- ---------------------------------------------------------------------------
-- 7) reviews（無償の感想 12件）
--    スタッフ別に散らし、rating(1..4=改善..最高)・tags・share_scope を混在。
--    → スタッフホームの Team voices / 店長Inbox（everyone・manager_only）が埋まる。
--    固定UUID + ON CONFLICT(id) DO UPDATE で冪等。created_at は seed 実行時の当月基準の
--    相対日で生成する（下記 rel_ts の D=何日前・H:M=JST時刻）。当月＋直近2ヶ月に散らばり、
--    ダッシュボードの「今月」ビューと echo flow（直近3ヶ月）が毎月 seed し直さなくても埋まる。
--    ★rel_ts(D,H,M) = 「JSTの D日前 の H:M」を timestamptz に変換（未来日にならないよう D>=1）。
-- ---------------------------------------------------------------------------
insert into public.reviews (id, customer_id, salon_id, staff_id, body, rating, tags, share_scope, created_at)
values
  ('dededb01-0000-0000-0000-000000000000','deded001-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa01-0000-0000-0000-000000000000',
   'カウンセリングがとても丁寧で、なりたいイメージをしっかり汲み取ってくれました。仕上がりも大満足です。', 4, array['カウンセリング','仕上がり'], 'everyone',    (date_trunc('day', now() at time zone 'Asia/Tokyo') - make_interval(days=>59) + make_interval(hours=>11,mins=>20)) at time zone 'Asia/Tokyo'),
  ('dededb02-0000-0000-0000-000000000000','deded001-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa02-0000-0000-0000-000000000000',
   '初めてで緊張していましたが、会話が心地よくてリラックスできました。またお願いします。', 4, array['接客','居心地'], 'everyone',                          (date_trunc('day', now() at time zone 'Asia/Tokyo') - make_interval(days=>52) + make_interval(hours=>15,mins=>5)) at time zone 'Asia/Tokyo'),
  ('dededb03-0000-0000-0000-000000000000','deded003-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa03-0000-0000-0000-000000000000',
   'カラーの色持ちがよく、艶のある仕上がりで気に入っています。', 4, array['技術','仕上がり'], 'everyone',                                                   (date_trunc('day', now() at time zone 'Asia/Tokyo') - make_interval(days=>48) + make_interval(hours=>13,mins=>40)) at time zone 'Asia/Tokyo'),
  ('dededb04-0000-0000-0000-000000000000','deded004-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa04-0000-0000-0000-000000000000',
   'シャンプーが気持ちよくて、つい眠ってしまいました。気配りが素晴らしいです。', 4, array['居心地','挨拶'], 'everyone',                                     (date_trunc('day', now() at time zone 'Asia/Tokyo') - make_interval(days=>42) + make_interval(hours=>17,mins=>10)) at time zone 'Asia/Tokyo'),
  ('dededb05-0000-0000-0000-000000000000','deded001-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa02-0000-0000-0000-000000000000',
   '仕上がりはよかったのですが、少し待ち時間が長く感じました。次回に期待しています。', 2, array['受付'], 'manager_only',                                    (date_trunc('day', now() at time zone 'Asia/Tokyo') - make_interval(days=>38) + make_interval(hours=>12,mins=>0)) at time zone 'Asia/Tokyo'),
  ('dededb06-0000-0000-0000-000000000000','deded003-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa01-0000-0000-0000-000000000000',
   '毎回安定して素敵に仕上げてくれるので信頼しています。', 4, array['技術','仕上がり'], 'everyone',                                                         (date_trunc('day', now() at time zone 'Asia/Tokyo') - make_interval(days=>32) + make_interval(hours=>10,mins=>30)) at time zone 'Asia/Tokyo'),
  ('dededb07-0000-0000-0000-000000000000','deded004-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa03-0000-0000-0000-000000000000',
   '希望を伝えると具体的な提案をしてくれて、とても参考になりました。', 3, array['カウンセリング'], 'either',                                                 (date_trunc('day', now() at time zone 'Asia/Tokyo') - make_interval(days=>27) + make_interval(hours=>14,mins=>25)) at time zone 'Asia/Tokyo'),
  ('dededb08-0000-0000-0000-000000000000','deded001-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa01-0000-0000-0000-000000000000',
   '店内の雰囲気が落ち着いていて、居心地がとても良かったです。', 4, array['居心地'], 'everyone',                                                            (date_trunc('day', now() at time zone 'Asia/Tokyo') - make_interval(days=>21) + make_interval(hours=>16,mins=>0)) at time zone 'Asia/Tokyo'),
  ('dededb09-0000-0000-0000-000000000000','deded003-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa04-0000-0000-0000-000000000000',
   '受付から丁寧で、初めてでも安心して過ごせました。', 3, array['受付','挨拶'], 'everyone',                                                                 (date_trunc('day', now() at time zone 'Asia/Tokyo') - make_interval(days=>15) + make_interval(hours=>11,mins=>45)) at time zone 'Asia/Tokyo'),
  ('dededb10-0000-0000-0000-000000000000','deded001-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa03-0000-0000-0000-000000000000',
   'トリートメント後の手触りが全然違いました。おすすめです。', 4, array['技術','仕上がり'], 'everyone',                                                     (date_trunc('day', now() at time zone 'Asia/Tokyo') - make_interval(days=>9) + make_interval(hours=>13,mins=>15)) at time zone 'Asia/Tokyo'),
  ('dededb11-0000-0000-0000-000000000000','deded004-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa02-0000-0000-0000-000000000000',
   '普通に良かったです。次はカラーもお願いしてみたいです。', 3, array['技術'], 'either',                                                                    (date_trunc('day', now() at time zone 'Asia/Tokyo') - make_interval(days=>4) + make_interval(hours=>15,mins=>30)) at time zone 'Asia/Tokyo'),
  ('dededb12-0000-0000-0000-000000000000','deded001-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa01-0000-0000-0000-000000000000',
   '今日もありがとうございました。仕上がりが好きで通い続けています。', 4, array['仕上がり','挨拶'], 'everyone',                                              (date_trunc('day', now() at time zone 'Asia/Tokyo') - make_interval(days=>1) + make_interval(hours=>12,mins=>50)) at time zone 'Asia/Tokyo')
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
--    stripe_payment_id（unique）= 'demo_pi_*' で冪等。created_at は reviews 同様「seed 実行時の
--    当月基準の相対日」で生成（rel_ts の D=何日前・H:M=JST時刻）。
--    ★ON CONFLICT DO UPDATE で created_at/staff/tier/amount を再seed時に当月へ更新する
--      （demo_pi_* のデモ行のみ対象＝実データには当たらない）。
-- ---------------------------------------------------------------------------
insert into public.rating_purchases (customer_id, salon_id, staff_id, tier, amount, stripe_payment_id, created_at)
values
  -- 主persona（マイページ履歴用・6件）
  ('deded001-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa01-0000-0000-0000-000000000000','amazing',      3000,  'demo_pi_0001', (date_trunc('day', now() at time zone 'Asia/Tokyo') - make_interval(days=>59) + make_interval(hours=>11,mins=>25)) at time zone 'Asia/Tokyo'),
  ('deded001-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa02-0000-0000-0000-000000000000','grateful',      500,  'demo_pi_0002', (date_trunc('day', now() at time zone 'Asia/Tokyo') - make_interval(days=>52) + make_interval(hours=>15,mins=>10)) at time zone 'Asia/Tokyo'),
  ('deded001-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa03-0000-0000-0000-000000000000','wonderful',    1000,  'demo_pi_0003', (date_trunc('day', now() at time zone 'Asia/Tokyo') - make_interval(days=>21) + make_interval(hours=>16,mins=>5)) at time zone 'Asia/Tokyo'),
  ('deded001-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa01-0000-0000-0000-000000000000','thank_you',     100,  'demo_pi_0004', (date_trunc('day', now() at time zone 'Asia/Tokyo') - make_interval(days=>9) + make_interval(hours=>13,mins=>20)) at time zone 'Asia/Tokyo'),
  ('deded001-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa04-0000-0000-0000-000000000000','grateful',      500,  'demo_pi_0005', (date_trunc('day', now() at time zone 'Asia/Tokyo') - make_interval(days=>7) + make_interval(hours=>18,mins=>0)) at time zone 'Asia/Tokyo'),
  ('deded001-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa01-0000-0000-0000-000000000000','wonderful',    1000,  'demo_pi_0006', (date_trunc('day', now() at time zone 'Asia/Tokyo') - make_interval(days=>1) + make_interval(hours=>12,mins=>55)) at time zone 'Asia/Tokyo'),
  -- 脇役（件数の厚み・4件）
  ('deded003-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa03-0000-0000-0000-000000000000','wonderful',    1000,  'demo_pi_0007', (date_trunc('day', now() at time zone 'Asia/Tokyo') - make_interval(days=>48) + make_interval(hours=>13,mins=>45)) at time zone 'Asia/Tokyo'),
  ('deded003-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa01-0000-0000-0000-000000000000','amazing',      3000,  'demo_pi_0008', (date_trunc('day', now() at time zone 'Asia/Tokyo') - make_interval(days=>32) + make_interval(hours=>10,mins=>35)) at time zone 'Asia/Tokyo'),
  ('deded004-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa04-0000-0000-0000-000000000000','thank_you',     100,  'demo_pi_0009', (date_trunc('day', now() at time zone 'Asia/Tokyo') - make_interval(days=>42) + make_interval(hours=>17,mins=>15)) at time zone 'Asia/Tokyo'),
  ('deded004-0000-0000-0000-000000000000','deded000-0000-0000-0000-000000000000','dededa02-0000-0000-0000-000000000000','unforgettable',10000, 'demo_pi_0010', (date_trunc('day', now() at time zone 'Asia/Tokyo') - make_interval(days=>4) + make_interval(hours=>15,mins=>35)) at time zone 'Asia/Tokyo')
on conflict (stripe_payment_id) do update set
  staff_id   = excluded.staff_id,
  tier       = excluded.tier,
  amount     = excluded.amount,
  created_at = excluded.created_at;

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
