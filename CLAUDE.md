# CLAUDE.md — echo 実装仕様書

> Claude Code 用の設計図。echo（美容サロン向け 感謝・評価アプリ）のMVPを実装するための仕様。
> このファイルの「絶対原則」は規制・税務の根拠に直結するので、変更前に必ず人間に確認すること。
> 最終更新：2026.06.13

---

## 0. これは何か

echo は、お客様がサロンのスタッフへ「感想（無償）」と「評価スタンプ（有償）」を送れるアプリ。
- 評価スタンプの売上は **全額サロンへ**（echoは手数料を取らない／資金を預からない）
- 感想を送ると「貯まるスタンプ（無償）」が貯まり、特典と交換できる
- 評価はサロンがスタッフの賞与査定に裁量で反映する

運営：合同会社cartaLLC（将来的に株式会社響くエンターテイメントへ分離予定）

---

## 1. 絶対原則（崩すと規制・税務の整理が壊れる）

実装中、以下に反するコードを書きそうになったら **手を止めて人間に確認**すること。

1. **echoは資金を預からない。** 決済は Stripe Connect の **Direct Charge**。代金はお客様→サロンの連結アカウントに直接入る。echoの口座を経由しない。
2. **application fee = 0。** echoはスタンプ取引から手数料を取らない。Stripe APIで `application_fee_amount` を設定しない（または0）。
3. **Stripeの手数料負担者（fee payer）は連結アカウント（サロン）側。** 連結アカウント作成時に設定する。ここを間違えるとechoにConnect費用が発生する。
4. **評価スタンプ（有償）と貯まるスタンプ（無償）は別テーブル・別概念。** 絶対に統合しない。
   - 評価スタンプ = 役務の対価（買い切り）。残高・チャージ・価値の保存を持たせない。
   - 貯まるスタンプ = 来店記録のcountのみ。金額に一切換算しない。
5. **評価スタンプは買い切り。** 残高として保存・繰越・払い戻し・他用途への利用をさせない。
6. **スタッフは評価の対象であって、金銭の受取人ではない。** スタッフ個人へ送金する導線・データを作らない。
7. **賞与は購入代金と機械的に連動させない。** 「スタンプ¥X = 賞与¥Y」のような自動計算ロジックを実装しない。集計の参考値を表示するに留める。
8. **個人情報はecho側で一元管理。** サロンは自店の感想・スタンプ記録のみ参照可。顧客の個人情報（LINE ID・氏名等）はサロンから見えないようにする（後述のRLS）。

---

## 2. 技術スタック

- フロント／API：Next.js（App Router）＋ TypeScript
- DB／認証：Supabase（PostgreSQL・東京リージョン）
- 決済：Stripe Connect（Direct Charge）
- 認証：LINE ログイン（MVPから）。開発段階は個人名義のLINE Developersチャネルで可
- ホスティング：Vercel（Pro契約済み）
- リポジトリ：TOMOTIPINN/TIPINN

---

## 3. データモデル（MVP・8テーブル）

### customers（顧客＝中央台帳）
echo全体で1アカウント。複数サロンを横断する本体。
- id (uuid, PK)
- line_user_id (string, unique) — LINEログインの識別子
- display_name (string)
- created_at (timestamp)

### salons（サロン）
- id (uuid, PK)
- name (string)
- logo_url (string) — 貯まるスタンプに使う円形ロゴ
- stripe_account_id (string) — 連結アカウントID

### staff（スタッフ）
- id (uuid, PK)
- salon_id (uuid, FK → salons)
- name (string)
- photo_url (string)

### reviews（感想＝無償）
- id (uuid, PK)
- customer_id (uuid, FK → customers)
- salon_id (uuid, FK → salons)
- staff_id (uuid, FK → staff)
- body (text)
- created_at (timestamp)

### rating_purchases（評価スタンプ＝有償・お金が動く台帳）
- id (uuid, PK)
- customer_id (uuid, FK → customers)
- salon_id (uuid, FK → salons)
- staff_id (uuid, FK → staff) — 評価対象。受取人ではない
- tier (string) — thank_you / grateful / wonderful / amazing / unforgettable
- amount (int) — 100 / 300 / 500 / 1000 / 10000（記録用。残高ではない）
- stripe_payment_id (string)
- created_at (timestamp)
- ※ 残高・チャージ・繰越カラムは持たせない（絶対原則5）

### earned_stamps（貯まるスタンプ＝無償・金額なし）
- id (uuid, PK)
- customer_id (uuid, FK → customers)
- salon_id (uuid, FK → salons)
- count (int) — サロンごとの貯まり数。金額換算しない
- ※ (customer_id, salon_id) でユニーク

### rewards（特典）
- id (uuid, PK)
- salon_id (uuid, FK → salons)
- required_count (int) — 必要スタンプ数（例：5）
- title (string) — 例：シャンプー指名無料

### （感想と評価スタンプの関係）
評価スタンプは感想に紐づくこともある（0または1）。rating_purchases に review_id (uuid, FK, nullable) を持たせて表現。感想だけ送って課金しないケースが通常。

---

## 4. RLS（行レベルセキュリティ）の方針

Supabase の RLS を必ず有効化する。MVP時点の原則：
- **顧客**：自分の customer_id に紐づく行（自分の感想・購入・スタンプ）のみ参照可。
- **サロン**：自店 salon_id の reviews / rating_purchases / earned_stamps / staff / rewards のみ参照可。**customers テーブルの個人情報カラムには触れない**（必要な表示名は最小限のビュー越しに）。
- **echo運営**：service role 経由でのみ全体参照（管理画面・集計）。
- マルチテナントの起点は salon_id。クエリは常に salon_id でスコープする。

---

## 5. 決済フロー（Stripe Connect / Direct Charge）

### サロンのオンボーディング
1. サロン登録時に Stripe の連結アカウントを作成（Account Links でオンボーディング）
2. **fee payer を連結アカウント側に設定**（絶対原則3）
3. 銀行口座を登録（サロン自身が入力）。echoは口座情報を保持しない

### 評価スタンプ購入（お客様）
1. お客様が tier を選択 → PaymentIntent を作成
2. **on_behalf_of / transfer先 = サロンの連結アカウント**、**application_fee_amount は設定しない（=0）**
3. 決済成功の Webhook を受けて rating_purchases に記録
4. スタッフへ通知（LINE）

### echo自身のStripe費用
- スタンプ取引：echoの負担なし（手数料はサロン負担）
- echoの収益＝月額利用料の集金分のみ。Stripe Billing 利用なら 決済 約3.6%＋Billing 0.7% ≈ 4.3%（＋消費税）

### テスト
- 開発は全て **テストモード**で行う。本番アカウント有効化（法人確定後）まで実カードは扱わない

---

## 6. LINE 連携

- **LINEログイン**：customers.line_user_id に紐づけ。MVPから使用
- **LINE通知**（公式アカウント）：評価・感想の到着をスタッフ／お客様へ push。※公式アカウントの本番運用は法人確定後（外部公開のタイミング）。開発中はログイン優先で進める

---

## 7. MVPのスコープ（最小の一周）

これだけ作れば1周回る。これ以外は後回し。
1. お客様：LINEログイン → ホーム（貯まるスタンプ表示）
2. お客様：感想を送る（reviews 作成 → earned_stamps の count +1）
3. お客様：評価スタンプを購入（Stripeテスト決済 → rating_purchases 作成）
4. スタッフ：評価・感想の通知を受け取る
5. お客様：貯まるスタンプが required_count に達したら特典表示

### MVPに含めない（次フェーズ）
- 運営者ダッシュボード、ランク制、月額課金の実装、Team voices、ネガティブ感想の店長フィルタ、PayPay、多店舗横断のUI演出 など

---

## 8. ドッグフーディング

直営CARTAで実際に回して検証する。最初の加盟店＝CARTA。

---

## 9. まだ決まっていない（実装前に確定が要る箇所）

- 月額利用料の金額
- tier ごとの表示文言の最終確定（英語ラベルは確定済み：Thank you / Grateful / Wonderful / Amazing / Unforgettable）
- 税理士回答待ち：スタンプ売上の消費税・税込価格・領収書発行の主体（→ 価格と表示に影響）
- 運営主体（cartaLLC のまま開発 → 外部公開前に響くエンターテイメントへ）
