# echo — プロジェクトガイド（単一ソース・オブ・トゥルース）

> このファイルはリポジトリ直下に置く。Claude Code は起動時に自動で読む。
> **ここに書かれた決定が常に優先される。** メモ・PDF・過去の記憶と矛盾したら、まずこのファイルを正とする。
> UIの視覚デザインは `/docs/ui-v2.2.pdf`（echo Complete UI Design v2.2）を参照。
> 最終更新: 2026-07-08

---

## 1. echo とは
美容サロン向け「感謝 × 評価」アプリ。お客様が担当スタッフへ
①感想（無償レビュー）②有償の「評価スタンプ」を送れる。
- ブランド: **Your work echoes.**
- 旧名 tipinn。リポジトリ名・package名は `tipinn` のまま、製品名は **echo**。

---

## 2. 絶対原則（崩すと規制・税務が壊れる。最優先で死守）
1. echo は資金を預からない（Stripe Connect **Direct Charge**）
2. application fee = **0**
3. 有償スタンプ（評価）と無償スタンプ（貯まる）は**別テーブル**
4. 評価スタンプは買い切り・残高なし＝**即時送信型**
5. スタッフは「評価対象」であり金銭受取人ではない（お金はサロン名義で受領 → 賞与等で反映）
6. 賞与は購入代金と機械的に連動させない
7. 個人情報は echo 一元管理（サロンは自店データのみ）
8. 価格は echo 側で固定。サロンは金額もパターン数もいじれない

---

## 3. 技術スタック / 規約
- Next.js 16（App Router, Turbopack）/ Supabase（東京, project id: `ztvjwfofznqndqbsnluq`, 名称「エコー」）/ Vercel / Stripe Connect Direct Charge / LINEログイン
- Repo: `github.com/TOMOTIPINN/TIPINN`（main直コミット）/ ローカル: `~/dev/TIPINN`（Mac / zsh）
- **Supabaseは新キー命名**。env は以下:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`（旧 anon key 相当）
  - `SUPABASE_SECRET_KEY`（旧 service_role key 相当）
- **DB書き込みは全て** `@/lib/supabase-admin` の共有 `supabaseAdmin`（service_role）をサーバー側で使う。**独自に `createClient` しない。**
- **マイグレーションは `supabase/migrations/` にSQLを置きつつ、適用は常にSupabase SQLエディタで手動。`supabase db push` は使わない。**
- **既存関数を `drop function` → `create function` で再定義する migration を書くときは、必ず本番の `prosrc` を `select` して現行本文を確認し、過去の migration が追加した処理を全部持ってくること。**（実例: 0019 が 0014 の `notification_outbox` enqueue を落とし、7/8〜7/10 の2日間、全サロンで来店リマインド通知が停止した。0021 で再統合。）
- **関数の signature（引数の型・数）を変える migration は、`create or replace` では“置き換わらない”。** PostgreSQL は関数を「名前＋引数型の並び」で識別するため、引数の型（例: `smallint`→`integer`）や引数の数を1つでも変えると、`create or replace` は既存定義を置き換えず**別関数として新規作成**し、古い定義が残って**同名関数が複数並存**する。これは PostgREST の `PGRST203 "Could not choose the best candidate function"`（候補を一意に選べず全呼び出しが失敗）や、意図しない旧版の呼び出しを招く。`drop function if exists ...(旧シグネチャ)` を書いても、DROP の引数型が本番の現行関数と1つでもズレると DROP は黙って空振りし、同じ事故になる。（実例: `submit_review_and_earn_stamp` が3バージョン並存し、感想送信が全て 500 になっていた。2026-07-12 発見・修正。）**対策: RPC の signature を変える migration の後は必ず `pg_proc` を `select` して同名関数が1つだけかを確認する。**
  ```sql
  select p.oid,
         pg_get_function_identity_arguments(p.oid) as args,
         pg_get_function_result(p.oid)             as result
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = '<関数名>';
  -- 2行以上返ったら並存＝事故。古い方を drop function public.<関数名>(<旧引数型>) で除去する。
  ```
- **migration の「作成」と「適用」は別物。** ローカルで `supabase/migrations/` に SQL ファイルを作っただけでは**本番 DB には一切反映されない**。必ず **Supabase SQL エディタで手動適用（＋ 列/index を変えたら `notify pgrst, 'reload schema';` でスキーマキャッシュをリロード）を先に実行**し、`REST` または `information_schema` でカラム/オブジェクトの**実在を確認してからコードを push** する。（実例: 0023 を「適用した」つもりがファイル作成だけで、本番に `staff.idempotency_key` が無く REST が `column ... does not exist` を返し続けた。2026-07-12。）
- **表示制御の `disabled` を、送信が必要な `input`/`select`（特に `name` 等の必須フィールド）に付けてはいけない。** ネイティブ form POST では **`disabled` 要素は送信データから脱落**し（HTML 仕様）、サーバー側で必須欠落エラー（例: `invalid_name` 400）→ フォームがハングする。送信中に入力を止めたいなら `readonly` ＋ `pointer-events`、または **fetch 送信にして body を state から明示構築**する（DOM シリアライズに依存しない）。（実例: `AddStaffForm` で送信中に name input を disabled にし、name 欠落で 400・「作成中…」のまま復帰不能。2026-07-12・fetch 化で解消。）
- **`position: fixed` のモーダル/オーバーレイは `createPortal(..., document.body)` で body 直下に出す。** 祖先要素に `transform`（`animate` 系の `translate` 等を含む・`translateY(0)` でも該当）があると、`position: fixed` の基準がビューポートでなくその祖先になり、中央配置のモーダルが画面外へ飛ぶ。（実例: `.animate-in` の `transform` に閉じ込められ、削除モーダルがオーバーレイだけ見えて中身が画面外。2026-07-12・portal 化で解消。）
- **取り返しのつかない操作（hard delete 等）は「原因を1つ直す」のではなく「確認を経た状態でしか実行に到達できない」ガードで構造的に守る。** 実行関数の入口で、モーダルの open 状態と実行条件（対象の件数が 0 等）を検査し、満たさなければ即 `return` する。単一機序に依存せず、状態の完全初期化・毎回新しいモーダルDOM（`key`）等と合わせた多層防御にする。（実例: スタッフ連続削除の2回目で確認がスキップされた件を、`handleDelete` 入口ガード＋全リセット＋portal key で不能化。2026-07-12。）
- **顧客の表示に関わる bool フラグ（`visit_axis_enabled` 等）は、新規サロン登録時に DB のカラムデフォルトで決まる。表示系フラグを追加・変更するときは、デフォルトが「顧客に見える側」になっているか必ず確認すること。**（実例: `visit_axis_enabled` が `default false` で作られており、新店の来店カードが全顧客に非表示になっていた。2026-07-11 発見・修正、0022 でデフォルト true 化。）
- セッション: `@/lib/session` の `getSession()` → `{ customer_id, line_user_id } | null`。Cookie名 `echo_session`。

---

## 4. データモデル（7テーブル / RLS deny-by-default・service_role のみアクセス）
- `customers`(id, line_user_id, …) — 中央台帳
- `salons`(id, **name必須**, logo_url, stripe_account_id, created_at)
- `staff`(id, **salon_id必須**, **name必須**, photo_url, created_at)
- `reviews`(id, customer_id, salon_id, staff_id, body, **rating**, **tags**, **share_scope**, created_at) — 無償レビュー
  - `rating` int 1..4（4=最高 / 3=よい / 2=普通 / 1=改善）
  - `tags` text[]（体験タグ・複数可。当面 受付/カウンセリング/技術/挨拶/居心地/仕上がり をハードコード。将来 A4 で可変化）
  - `share_scope` text（`manager_only` / `everyone` / `either`）
  - 列はnullable+null許容CHECK（既存行保護）。非nullの強制はRPC側。migration 0004。
- `rating_purchases`(id, …, tier, amount, stripe_payment_id, …) — 有償・お金の台帳（**残高カラム無し**）
- `earned_stamps`(id, customer_id, salon_id, count, updated_at) — 無償・countのみ。`unique(customer_id, salon_id)`
- `rewards`(id, required_count, title, …)

**貯まるスタンプ付与ルール**: **1個 / 顧客 / サロン / 日（JST・Asia/Tokyo基準）**。
その日その(顧客,サロン)で最初の感想送信のときだけ +1。2回目以降は感想は記録されるがスタンプは増えない。

**RPC**: `submit_review_and_earn_stamp(p_customer_id, p_salon_id, p_staff_id, p_body, p_rating, p_tags, p_share_scope)` → `(review_id, new_count, **stamp_awarded**)`
（review挿入 ＋ 上記ルールでの earned_stamps +1 を1トランザクションで原子的に実行。同一(顧客,サロン)は advisory lock で直列化）
- `stamp_awarded` = 今回の送信でスタンプが付与されたか（false=今日はもう貯まっている）。完了画面のメッセージ分岐に使う。

---

## 5. デザインシステム（最重要・全画面共通）
**世界観: 白＝お客様の世界 ／ 黒＝管理者の世界。上品・余白たっぷり・カードUI。**

### フォント
- 英字・見出し・アイブロウラベル: **Cormorant Garamond**（しばしば *italic*）
- 和文: **明朝**（Shippori Mincho もしくは Noto Serif JP）
- system-ui / sans-serif をUIの主役にしない

### カラートークン
- `--g25: #9E9C95;` ← **echoの基調色**（warm grey。アイブロウ・補助テキスト・罫線・控えめ要素）
- `--ink: #2B2B2B;` 主テキスト（墨色寄り。**純黒は使わない**）
- `--bg: #FFFFFF;` 背景（ごく僅かに暖色のオフホワイト可）
- `--card: #FFFFFF;` ＋ 非常に淡いシャドウ・角丸
- 管理者ダーク世界: 黒背景 ＋ 白文字
- **鮮やかなピンク/赤をアクセントに使わない**（現状フォームの `#E53E3E` 系ボタンはNG）

### 共通パターン
- 英字 italic serif の小さなアイブロウ label（G2.5）→ その下に明朝の見出し
  - 例: *Share your feedback* ／「どなたに感想を送りますか？」
- ボタンは控えめ（テキスト的 or 細枠。鮮やかな塗りボタンにしない）
- 貯まるスタンプ ＝ 加盟店の**円形ロゴ**（CARTAの丸など。logo_url）
- コピーは温かく急かさない（「おうちでもOK」「あとで送る」を堂々と用意）

### 参照実装（globals.css にこの方向でトークン化。既存ページに値があればそれに合わせる）
```css
:root{
  --g25:#9E9C95;
  --ink:#2B2B2B;
  --bg:#FFFFFF;
  --line:#ECEAE6;
  --radius:16px;
  --shadow:0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.04);
}
/* Cormorant Garamond + Shippori Mincho を next/font（または <link>）で読み込み、
   英字=Cormorant / 和文=明朝 になるよう font-family を設定する */
```

---

## 6. 評価スタンプ価格（★確定・税込 / 2026-06-16・Wonderful改定 2026-06-18★）
| ラベル | 価格 |
|---|---|
| Thank you | ¥100 |
| Grateful | ¥500 |
| Wonderful | ¥1,000 |
| Amazing | ¥3,000 |
| Unforgettable | ¥10,000 |

- 全て税込（消費税 = amount × 10/110）。消費者向けは税込表示。
- `rating_purchases` に CHECK制約で固定済み（amount限定 ＋ tier×amount のペア固定）。
- ⚠️ **UI v2.2 PDF(06-09) は旧価格（¥300 / 500 / 1,000）を表示している。こちらの表が新・正。PDF は要更新。**

---

## 7. 画面マップ（視覚は `/docs/ui-v2.2.pdf` 参照・全26画面）
- **Onboarding**: O1 ようこそ / O2 登録 / O3 登録完了
- **Customer（白）**:
  - 01 ホーム
  - 02 スタッフ選択（写真カード・役職分類[スタイリスト/アシスタント]・「サロン全体へ」）
  - 03 感想入力 ＝ 絵文字評価4段階（最高/よい/普通/改善）＋「体験の中で」タグ複数可 ＋ コメント**15〜300字** ＋ 共有範囲[店長のみ/全員に/どちらでも]
  - 04 評価スタンプ選択 / 05 購入確認 / 06 送信完了 / 07 特典解除 / 08-09 特典使用 / 10 マイページ / P1 決済登録
- **Staff / Manager**: 11 店長Inbox（全員共有/店長控え）/ 12 スタッフホーム / 13 スタッフ通知
- **Owner**: 14 オーナーダッシュボード（全店横断）
- **Admin（ダーク）**: A1 スタッフ一覧 / A2 スタッフ編集 / A3 特典設定 / A4 タグ設定 / A5 スタンプ設定 / A6 店舗プロフィール（ロゴ円アップ）/ A7 Stripe入金設定

---

## 8. ビルド規約
- デザインは**共有トークン/コンポーネント**を使う。**インラインstyle禁止。**
- DB書き込みは共有 `supabaseAdmin`、**サーバー側のみ**（RLS deny-by-default）
- 新画面を作る前に、必ず §7 の画面マップと PDF の該当画面を確認する
- ログイン後は returnTo（戻り先URL）を保持して元ページに戻す（QR導線のため）
- 顧客向けコピーは温かく・急かさない

---

## 9. 専門家確認の要点（記録）
- 金融庁フィンテックサポート: 資金移動業不要・前払式非該当の見解取得済
- 税理士: 評価スタンプ売上は課税売上10%・税込表示 / 即時送信型なら購入時課税（規約に「即時送信型」明記）/ 領収書発行義務はサロン側、echo がサロン名義で発行サポート（オン/オフ可）/ 賞与反映は給与所得・源泉徴収
- 社労士: 賞与から開始が無難
- 弁護士: 利用規約の最終確認（未）

## 10. 法人化トリガー
「外部サロンに出す瞬間」に法人設立・Stripe本番・LINE公式・規約の事業者名を集約。
運営社名: **株式会社響くエンターテイメント**（予定・設立7〜8月目安）。それまでは cartaLLC / 個人名義。

---

## 11. 現在の進捗
- フェーズ1 DBスキーマ … ✓
- フェーズ2 LINEログイン … ✓
- フェーズ3 感想送信＋貯まるスタンプ … ✓（画面03/06まで一周）
  - RPC `submit_review_and_earn_stamp`（rating/tags/share_scope対応・stamp_awarded返却・1日1個ルール）✓ migration 0004
  - `POST /api/reviews`（rating/tags/share_scope検証＋RPC連携）✓ / `GET /api/staff?salonId=` ✓
  - `/review` フォーム ✓ 絵文字評価4段階/体験タグ複数可/共有範囲/コメント15〜300字（§5準拠・`@/components/ui`・インラインstyle無し）
  - `/review/complete` 送信完了画面 ✓ stamp_awardedで分岐・円スタンプ点灯・マイページ/ホーム導線（再送ループ無し）
  - `/mypage`（画面10）✓ サロンごとのスタンプカード（円形ロゴ＋スタンプリング＋次の特典までの進捗 / rewards未設定でも壊れない）。`StampRing` を `@/components/ui` に共通化
  - 体験タグは当面ハードコード（将来 A4 タグ設定で可変化）
  - 感想の重複投稿制限（1顧客/1サロン/JST日 につき1回）… ✓ migration 0020
    - RPC `submit_review_and_earn_stamp` を 0020 で再定義（戻り値に `already_submitted` 追加）。advisory lock 内で INSERT 前に当日(JST) review の存在を確認し、既存なら**挿入せず** `already_submitted=true` を返す。判定単位はスタンプの「1個/顧客/サロン/日(JST)」と同一＝**staff 非依存**（ALL staff も個別も「その日の1回」／個別複数送信は不可）。本日初回分岐は定義上 `stamp_awarded=true` 固定
    - reviews に UNIQUE は張らない（`(created_at AT TIME ZONE 'Asia/Tokyo')::date` は STABLE で関数一意index不可・既存重複行で作成失敗のリスク）。0004/0009/0019 と同じ advisory lock + RPC内判定で担保
    - `POST /api/reviews` は `already_submitted` を**エラーでなく 200 `{ alreadySubmitted: true }`** で返す（客を責めない）。`ReviewForm` は既送信時 `/review?salon=` へ `router.replace`
    - `/review`（server）は `@/lib/review-server` の `hasReviewedToday()`（当日既送信判定・supabaseAdmin をクライアントに巻き込まないサーバー専用モジュール）で、既送信ならフォームを出さず**インライン既送信カード**（「本日分の感想は送信済みです／またのご来店をお待ちしています」＋マイページ/ホーム導線）。URL直打ち・リロードでも同一画面＝サーバー側で守る（UI非表示だけに依存しない）
    - 感想スタンプの 1個/日 farming 対策（0004）は不変。今回は review 投稿そのものの重複制限を追加しただけ
- フェーズ4 評価スタンプ購入（Stripe Connect / Direct Charge）… 🚧 実装中
  - 4.0 Stripe下準備 … ✓ テストモード（platform名 echo）/ 連結アカウント `acct_1TjCCY50hwlsDBtH`（Standard・Direct Charge＝連結が手数料負担）→ テストサロン `682336ef-997e-4b07-876e-b71fb032b71b` の `salons.stripe_account_id` に紐付け済 / env: `STRIPE_SECRET_KEY` `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` `APP_BASE_URL` / `stripe@22` 導入済
  - 4.1 購入フロー（顧客側）… ✓
    - tier定義 `@/lib/rating-tiers`（価格の唯一の正・原則8。§6/CHECK制約と一致）/ Stripeクライアント `@/lib/stripe`
    - `POST /api/checkout` … Checkout Session を**連結アカウント上で作成**（`{ stripeAccount }`・Direct Charge）。mode=payment / application_fee無し（=0）/ customer_idはセッション由来 / amountはサーバーtier定義のみ採用 / metadataに customer/salon/staff/tier/amount(+review_id)
    - `/rating?salon=&staff=`（画面04）… tier選択→/api/checkout→Stripe遷移。「感想だけ送る」導線あり（§5準拠・インラインstyle無し）
  - 4.2 Webhook（冪等記録: checkout完了→rating_purchases insert）… ✓
    - `POST /api/stripe/webhook`（runtime=nodejs）。生body=`req.text()`→`stripe.webhooks.constructEvent`で署名検証
    - ★Direct Chargeのため `checkout.session.completed` は**Connectイベント**（`event.account`=連結acct）。署名は**Connect専用シークレット** `STRIPE_CONNECT_WEBHOOK_SECRET`（.env.localに追加・要 whsec_ 設定）
    - `payment_status==='paid'` のみ記録 / 価格はサーバーtier定義が正（metadataのamountは不採用・原則8）
    - 冪等: `stripe_payment_id`(= payment_intent, DBで unique)に `upsert(onConflict, ignoreDuplicates)` ＝ ON CONFLICT DO NOTHING。記録のみ・賞与/残高ロジック無し（原則5・6）
    - tier CHECK は slug 一致のため migration 不要（0001/0003で確認済）
    - ⚠️ Stripeダッシュボードで **Connect用** webhookエンドポイント（`{APP_BASE_URL}/api/stripe/webhook`・checkout.session.completed）を作成し whsec_ を `.env.local` に設定すること
  - 4.3 完了画面 `/rating/complete?session_id=...`（success_urlの遷移先）… ✓ 静的な温かいサンキュー画面（DB書き込みなし＝記録はwebhook / 二重記録防止）。マイページ/ホーム導線。tier/金額表示はDirect Charge都合でMVP省略（§5準拠・インラインstyle無し）
- 来店スタンプ移行（旧LINEショップカード引き継ぎ・来店軸 / Phase 7 の上に追加）… ✓ migration 0019
  - `stamp_adjustments`(customer_id, salon_id, delta, source='migration', note, created_by, updated_by, …) 追加。`unique(customer_id, salon_id, source)`＝顧客×サロン×sourceで1回（冪等・訂正は既存行UPDATE）。RLS deny-by-default（service_roleのみ）
  - 累計来店の定義を **COUNT(visits) + COALESCE(SUM(stamp_adjustments.delta),0)** の1式に一本化。SQL側は RPC `submit_visit_and_earn_stamp` を 0019 で再定義（`new_count` に加算・`stamp_awarded` は不変＝当日初回来店の成否のみ）／app側は `@/lib/stamp-adjustments`（`getMigrationEntry` / `getCustomerMigrationDeltas`）が同式のミラー
  - 入力導線＝来店受付スキャナ `/staff/visit`（VisitScanner）。未移行時に残数入力欄（0〜`salons.visit_cycle_size`）→ 1タップ「移行して記録」で migrate→record を連続実行。既移行は移行済み表示＋「訂正」
  - `POST /api/staff/visit` に action `migrate`（未移行→INSERT / 既移行→UPDATE・0〜cycleSizeに正クランプ）。**入力・訂正は在籍staff/端末いずれも可＝ロール判定なし**。`created_by`/`updated_by` は「誰が入力・訂正したか」の追跡用に保持するだけ（操作は止めない・端末経路は個人特定不可で null）
  - `/mypage` は移行deltaを合算し、移行のみ（実来店ゼロ）のサロンもカード対象に含める。特典は count 純粋関数由来のため、移行でハードル到達→即発火（表示に自動反映）。感想軸（`earned_stamps`・3固定）は移行対象外＝不介入
  - ⚠️ 運用前提（コードでは強制しない・カットオーバー規律）: echo来店チェックインはカットオーバー時点から開始／delta＝カットオーバー時点の旧カード残高。移行時 COUNT(visits)≈0 のため実来店と重複しない（遡及バックフィルの除外ロジックは持たない）
- 不具合修正: staff/manager がホーム保存した PWA を起動すると顧客ホーム "/" 経由で /mypage に流れ、staff世界に入れなかった件 … ✓ DB変更なし
  - 主因＝PWA start_url。root layout が全ページ共通で customer 用 `/manifest.json`（start_url:"/"）を配るため、iOS16.4+ は保存パス /staff を無視して "/" から冷起動していた。**`/staff`・`/manager` 配下にセグメント layout を新設し `metadata.manifest` を `/manifest-staff.json`（start_url:"/staff"）に上書き**（ネスト metadata は scalar を最深セグメント優先で上書き＝`<link rel="manifest">` は1本）。manager も staff世界の住人＝専用manifestは別立てせず /staff に集約
  - 再発防止＝LINE callback の着地先にロール分岐を追加。**returnTo が明示ターゲット（/staff・/staff/join?token=…・/onboard…）なら尊重（署名付きstate往復＝#1は不変）／既定 "/" のときだけ `line_user_id` で在籍staff判定 → staff は /staff・非staff は "/"（顧客着地を維持）**。staff 解決は `@/lib/staff-session` の `resolveStaffByLineUserId`（session cookie 非依存・callback は cookie 発行前のため）に単一ソース化し `getStaffContext` もこれ経由
  - 顧客側（`public/manifest.json`・root `layout.tsx`・`page.tsx`・`@/lib/return-to`・login route）は**一切無改変**＝顧客ログイン（returnToなし→"/"着地）に回帰なし
- 受付端末（kiosk）を独立 PWA 化: 常設 iPad のアイコン1タップで来店受付カメラを開く（LINE不要・setup QR 再読み込み不要）… ✓ DB変更なし（2026-07-16）
  - 症状: `/staff/visit` を表示中でもホーム追加時に staff manifest（start_url:`/staff`）が使われ、アイコン起動が `/staff`→LINEログイン要求になっていた。加えて iOS の standalone PWA は Safari と**別 cookie ジャー**で、QR（Safari）で入れた `echo_device` がアイコン起動時に無く、start_url を変えるだけでは救えない
  - 対策＝**`/kiosk` 独立セグメント**を新設し per-salon 動的 manifest を配る:
    - `src/app/kiosk/manifest/route.ts`（動的・per-salon）: `?salon=&device=` を DB 突合（device_token 一致・非null / 不一致は 404）し、`name`＝「{サロン名} 受付」、**`start_url`＝`/kiosk/setup?salon=&device=`**、**`scope`＝`/kiosk`（末尾スラッシュ無し）**、`id`＝`/kiosk` を返す（`Cache-Control: no-store`）
    - `src/app/kiosk/layout.tsx`: `generateMetadata` が `echo_device` cookie を署名検証（`getDeviceCookie`・DB突合はしない）→ `manifest` を `/kiosk/manifest?salon=&device=` に上書き（scalar 最深優先＝`<link rel=manifest>` 1本 / cookie 無しは `/manifest-staff.json` へ退避）。あわせて `salons.name` を引いて `appleWebApp.title`＝「{サロン名} 受付」を出す（下記アプリ名の知見）／業務側 `icons`（apple=mint・favicon 併記）も同層で指定
    - `src/app/kiosk/page.tsx`: 受付スキャナ本体（start_url→303 の着地先）。**認可は device cookie のみ**（`getDeviceContext`・DB再照合）＝LINEに飛ばさない。`VisitScanner`＋`/api/staff/visit`（`getVisitContext`）を再利用
    - `src/app/kiosk/setup/route.ts`: 303 先を `/staff/visit`→**`/kiosk`**、失敗を `/kiosk?device=error` に変更（cookie 発行ロジックは不変）
  - **アイコン起動のたびに start_url=`/kiosk/setup` を通り cookie を張り直す**＝①standalone 別ジャー隔離 ②iOS ITP 失効 ③cookie 1年超え、を都度救う。**遷移は `/kiosk/setup`→`/kiosk` と全て scope `/kiosk` 内**に閉じ standalone を維持（scope の within はパス前方一致のため末尾スラッシュ無し必須。`/api/staff/visit` は fetch＝scope 対象外で問題なし）
  - **ホーム画面アプリ名は「どの追加経路か」で決まるソースが変わる（iOS の重要な落とし穴・2026-07-16 → 2026-07-17 実機で更新）。** iOS には2経路あり、優先ソースが異なる:
    - **新経路＝iOS 17.4+ の「Webアプリとして開く（standalone）」がON**（有効な manifest がある = `<link rel=manifest>` が読める）: **アプリ名は manifest の `name`/`short_name` が優先**され、**着地も manifest の `start_url`** になる。（実証・2026-07-17: `/dashboard` に `manifest-dashboard.json`（`name:"echo dashboard"` / `start_url:"/dashboard"`）を配り `appleWebApp` は未指定・`<title>` は「echo」だったが、iPhone のホーム追加でアプリ名は**「echo dashboard」＝manifest.name**、着地も **`/dashboard`** になった。）
    - **旧経路／manifest が読めない・standalone 無効のとき**: アプリ名は **`<meta name="apple-mobile-web-app-title">`（＝Next の `appleWebApp.title`）** → 無ければ **`<title>`** の順にフォールバックする。（`/kiosk` で当初 appleWebApp 未指定だったため、iOS が顧客 root の `<title>`「echo - 感謝と評価を、サロンへ」を拾っていたのはこの経路。⚠️ 2026-07-16 に「iOS は常に apple-mobile-web-app-title から取り manifest.name は見ない」と記録したが、これは**旧経路のみ成立**で、新経路では manifest.name が勝つ＝当時の断定は誤り。）
    - **Android/Chrome は経路によらず常に manifest の `name`。**
    - **対策＝どちらの経路に落ちても同じ名前になるよう、`manifest.name`（/`short_name`）と `appleWebApp.title` を同一文字列にそろえる。** `/kiosk` は既にこの方針で、**manifest route と `appleWebApp.title` を同一ソース（`salons.name`）・同一文字列（`` `${salonName} 受付` ``）**にして両経路・iOS/Android を一致させている（salon 特定不可時は汎用「echo 受付」）。
    - **`appleWebApp` を明示するのは、旧経路フォールバックで `<title>` に落ちてほしくない画面だけ**（現状は `/kiosk`）。専用 manifest を持つ `/dashboard`・`/staff` は新経路で manifest.name が使われるため、当面 appleWebApp は不要（`<title>` に落ちる旧経路の名前が「echo」等で許容できる範囲）。root は `<title>` 由来で足りる。
    - **iOS はアプリ名/アイコンを「追加時に確定・キャッシュ」する**＝名前やアイコンを変えても**既存のホーム画面アイコンには反映されない**。反映には**一度削除→再追加**が必要（実機検証時の必須手順）
  - `/staff/visit`（ログイン中スタッフ用・staff ホーム/`SalonNav` から被リンク）は**温存**＝端末経路だけ `/kiosk` に分離（既存導線に影響なし）
  - device_token は `salons` に1つ＝**iPad 3台で共有**。1台紛失で再発行すると全端末が失効し全台再スキャンが必要（3台規模では許容・端末別失効が要れば `device_tokens` テーブルへ分割）
  - ⚠️ **設計判断（token 露出）: per-salon manifest の start_url に device_token が載る**。据え置き受付端末を standalone で自己プロビジョニングさせるための対価で、**httpOnly cookie ほどは隠れない**ことを承知の上で採用する
    - ホーム画面 web clip 自体は iCloud 同期しない＝token はショートカット経由で伝播しない。漏れ口は **Safari 履歴/ブックマークの iCloud 同期**に限られる → 据え置き端末は**専用 Apple ID・Safari 同期OFF が推奨**
    - 既存 iPad が店長 Apple ID（同期ON）で運用開始する場合: 伝播先は**店長自身の端末＝すでに token に正当アクセスできる本人**なので実害は小さい。ただし**共用 Apple ID（店長以外も触れる）は不可**（本人前提が崩れる）。同期でコピー面が増える弱さは、**再発行＝全コピー即時失効**が担保する
    - token は**サロン単位の bearer**。被害範囲は当該サロンの来店記録に限定（他店越境不可・PII 非開放）。紛失時は `/manager/kiosk` で再発行
- `/dashboard`（オーナー向け数字管理ダッシュボード）を独立 PWA 化: アイコン1タップで `/dashboard` に着地する … ✓ DB変更なし（2026-07-17・commit `c6a5ee1`）
  - 症状: `/dashboard` は root layout を継承し顧客 `/manifest.json`（`start_url:"/"`）が配られていた（`curl` で `<link rel=manifest href=/manifest.json>` 確認）。iOS 17.4+ の「Webアプリとして開く」ON だとアイコン起動が manifest の `start_url` を使い、顧客トップ "/" に着地していた（実機再現）＝`/kiosk` と同型
  - 対策＝**`public/manifest-dashboard.json` 新規**（`name/short_name:"echo dashboard"` / `start_url:"/dashboard"` / **`scope:"/dashboard"`（末尾スラッシュ無し必須・within はパス前方一致）** / display standalone / icons favicon.ico 48x48）を配り、**`src/app/dashboard/layout.tsx` の静的 `metadata.manifest` を `/manifest-dashboard.json` に上書き**（scalar 最深優先＝`<link rel=manifest>` 1本）
  - **per-salon 不要＝静的 metadata で足りる**（`start_url` 固定・DBアクセスなし）。`/kiosk` の動的 manifest（device_token 突合）とは違い、`/dashboard` は同一オーナー配下の固定着地でよい
  - `icons` は既存どおり apple=mint（業務側）＋favicon 併記のまま（変更なし）。`appleWebApp` は付けない（上記アプリ名の知見どおり、新経路では manifest.name「echo dashboard」が使われる）
  - **無改変**: 顧客 `public/manifest.json`・`manifest-staff.json`・`/kiosk`・`/manager`・`/staff`（`/manager/staff` は既に `manifest-staff.json` で `/staff` 着地のため対象外）

---

## 12. デザインシステム（UI / ダッシュボード）

### 配色の二層ルール
- **カスタマーUI ＝ 暖色モノクロ＋ゴールド**。有彩色アクセントは `--gold #B08D57` の1色のみ（VIP）。§5の「鮮やか色・赤を使わない／上品・余白」を厳守。
- **サロンUI（ダッシュボード）＝ 同じ暖色ベース＋echoミント `--mint #11A697` をポイント使い**。ミントは「ブランド＋好調/上昇」だけに差す（ロゴ波紋・アクティブタブ・好調ステータス・締めコピー）。浴びせない。
- **ミントはサロンUI専用トークン（`--mint #11A697`）**。カスタマーUIには原則入れない。
  - **カスタマーUIで許可するミントは `--mint-visit #1FB89E` / `--mint-visit-soft #EAF3F0` のみ**（サロンUIの `--mint #11A697` とは別物）。用途は次の2つに限定する：①**来店ゲージ**（mypage の来店軸ドット・Phase 7）／②**ポジティブな主CTA**（例：完了画面の「評価スタンプを送る」＝`.btn-mint`）。**装飾・フチ取り・地色など、上記2用途以外にミントを広げない。**
- **赤は一切使わない（全体）**。ネガティブ（要ケア/減少）は赤ではなく**褪せたグレー**で表現。

### トークン（実機 :root）
- 明るい世界：bg `#FFFEFC` / card `#FFFFFF` / ink `#2B2B2B` / ink-soft `#55524C` / g25 `#9E9C95`(基調grey) / g25-soft `#BDBBB4` / line `#ECEAE6` / line-strong `#DAD7D1` / gold `#B08D57`
- ダーク管理：ink-bg `#1B1B1A` / ink-bg-card `#232220` / on-ink `#F3F1EC`
- サロン専用：mint `#11A697`（deep `#0E8E80` / tint `#E6F4F1` / line `#BFE3DD`）
- カスタマーUIで許可のミント（来店ゲージ＋ポジティブ主CTAのみ）：mint-visit `#1FB89E` / mint-visit-soft `#EAF3F0`
- フォント：本文=Noto Sans JP、金額/感謝/tier名/ブランド=明朝・Cormorant（`.font-elegant`限定）、ロゴ"ech"=Outfit

### ステータス配色（サロンHR）
- 好調/上昇＝**ミント** ／ 安定＝グレー ／ 要ケア/減少＝**褪せグレー**（赤禁止）
- ¥（金額）＝中立の明朝（色をつけない） ／ VIP＝ゴールド

### サロンダッシュボードは2タブ
- **日次ビュー**（`src/app/dashboard/page.tsx`）＝今の状態：店舗合計¥／スタッフ別（評価件数・ティア絵文字内訳・リアルボイス・前期間比）。**個人¥なし・スコアなし**。
- **HR月次ビュー**（echo flow）＝トレンド：echo flowの推移・要ケアアラート・好調/要ケア詳細。

### echo flow（HRの中核指標）
- 定義：**そのスタッフに届いた評価の流れ**（評価件数ベースの非金銭指標）。¥でも順位スコアでもない。
- **要ケア判定はトレンド（減少）で行う。絶対額の閾値は使わない**（若手＝低件数を構造的に「要ケア」と誤判定しないため）。離職予兆＝「承認が届かなくなること」。
- アラート例：「○○の echo flow が2ヶ月連続で減少」。
- おすすめアクションは**ルールベースの定型**（AI分析ではない）。お客様の声は生のまま表示し、人が読んで判断する。

### 関連原則（再掲）
- スタッフ個人の¥は出さない（チップ感回避・原則5）。お金は店舗合計のみ。
- 賞与は購入と機械的に連動しない（原則6・金融庁回答の前提）。echo flow・ダッシュボードは「判断材料」であって賞与自動算出ツールではない。

---

## 変更時セキュリティ・チェック（2026-07-14 棚卸しで確定した不変条件。機能追加・変更のたびに確認）

- **テナント分離は RLS ではなく `salon_id` スコープで担保する。** 全テーブルは RLS 有効・deny-by-default（直アクセスは全拒否）で、実分離は `supabaseAdmin` を使うサーバーコードが `ctx.salon_id`／`vctx.salon_id` で必ず絞ることで成立している。この salon_id は**必ずセッション由来**（`getStaffContext()` → `line_user_id` から `staff` を引いた DB 上の値）であり、**リクエストの body／query の salon_id は絶対に信用しない**。新しく `supabaseAdmin` で読み書きするクエリ・RPC を書くときは、`.eq("salon_id", vctx.salon_id)` 相当のスコープ（RPC なら `p_salon_id: vctx.salon_id`）を必ず付ける。（確認済: `staff-session.ts` が salon_id を DB 由来に固定＝越境不能。`api/staff/visit` 等の書き込みは全て自店スコープ。）
- **新テーブルを追加したら、必ず RLS を有効化して deny-by-default に乗せる。** 有効化を忘れた1テーブルが全テナント漏洩の穴になる。追加後に `select tablename, rowsecurity from pg_tables where schemaname='public'` で `rowsecurity=true` を確認する。（確認済: 現行10テーブルすべて有効。ポリシーは0件＝全拒否で正常。）
- **secret を `NEXT_PUBLIC_` に置かない。** `SUPABASE_SECRET_KEY`（service_role・RLSバイパス）は `@/lib/supabase-admin` 経由のサーバー側のみで使う。env を追加するとき、秘密値に `NEXT_PUBLIC_` prefix を付けない（バンドルに焼き込まれ全公開になる）。`.env`／`.env.local` は git 追跡しない（追跡は値の無い `.env.example` のみ）。（確認済: secret は `supabase-admin.ts` 1ファイルに隔離、クライアントは publishable key のみ、`.env` は check-ignore 済。）
- **積み残し（いつか閉じる・優先度低）:** ①`api/staff/visit` の `customers.display_name` 取得が salon_id 非スコープ（UUID 既知なら他店顧客の表示名のみ取得可・機微データは漏れない）。②`submit_visit_and_earn_stamp` RPC 内の customer↔salon 所属チェック（上流で salon_id が固定されるため越境は不能・念のためレベル）。
