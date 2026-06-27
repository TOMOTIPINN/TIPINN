# echo — プロジェクトガイド（単一ソース・オブ・トゥルース）

> このファイルはリポジトリ直下に置く。Claude Code は起動時に自動で読む。
> **ここに書かれた決定が常に優先される。** メモ・PDF・過去の記憶と矛盾したら、まずこのファイルを正とする。
> UIの視覚デザインは `/docs/ui-v2.2.pdf`（echo Complete UI Design v2.2）を参照。
> 最終更新: 2026-06-17

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

---

## 12. デザインシステム（UI / ダッシュボード）

### 配色の二層ルール
- **カスタマーUI ＝ 暖色モノクロ＋ゴールド**。有彩色アクセントは `--gold #B08D57` の1色のみ（VIP）。§5の「鮮やか色・赤を使わない／上品・余白」を厳守。
- **サロンUI（ダッシュボード）＝ 同じ暖色ベース＋echoミント `--mint #11A697` をポイント使い**。ミントは「ブランド＋好調/上昇」だけに差す（ロゴ波紋・アクティブタブ・好調ステータス・締めコピー）。浴びせない。
- **ミントはサロンUI専用トークン**。カスタマーUIには入れない。
  - **唯一の例外＝来店ゲージ**（mypage の来店軸ドット・Phase 7）。**専用トークン `--mint-visit #1FB89E` / `--mint-visit-soft #EAF3F0`** で表現し、サロンUIの `--mint #11A697` とは別物。来店ゲージ以外のカスタマーUIにミントを広げない。
- **赤は一切使わない（全体）**。ネガティブ（要ケア/減少）は赤ではなく**褪せたグレー**で表現。

### トークン（実機 :root）
- 明るい世界：bg `#FFFEFC` / card `#FFFFFF` / ink `#2B2B2B` / ink-soft `#55524C` / g25 `#9E9C95`(基調grey) / g25-soft `#BDBBB4` / line `#ECEAE6` / line-strong `#DAD7D1` / gold `#B08D57`
- ダーク管理：ink-bg `#1B1B1A` / ink-bg-card `#232220` / on-ink `#F3F1EC`
- サロン専用：mint `#11A697`（deep `#0E8E80` / tint `#E6F4F1` / line `#BFE3DD`）
- 来店ゲージ専用（カスタマーUIで唯一許可のミント）：mint-visit `#1FB89E` / mint-visit-soft `#EAF3F0`
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
