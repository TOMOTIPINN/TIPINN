# echo — 画面とAPI（Product）

> **実装されているものの唯一の正。**
> `find src/app -name "page.tsx" -o -name "route.ts"` の実測から作成（2026-08-11）。
> 画面を足したらここも足す。**推測で書かない。**
>
> 最終更新: 2026-09-06

---

## 1. 顧客の世界（白）

| ルート | 役割 |
|---|---|
| `/` | 顧客ホーム |
| `/onboard?salon=&t=` | **店頭オンボーディング**。初来店の受け口。店頭掲示QRから開く。友だち追加＋LINEログイン → 初回来店を1回だけ記録 → `/mypage` へ。`t` を `salons.visit_token` と照合 |
| `/onboarding/name` | **表示名の確定**。名前1項目のみ・必須・1回だけ（後から `/mypage` で変更可）。`name_confirmed_at` があれば素通し |
| `/visit?salon=&t=` | **来店記録**。顧客が店内QRから読み込む。salon 指定が無ければエラー表示 |
| `/review?salon=` | 感想入力。絵文字評価4段階＋体験タグ（複数可）＋コメント15〜300字＋共有範囲。当日既送信ならフォームを出さず既送信カード（サーバー側で守る） |
| `/review/complete` | 感想送信完了。`stamp_awarded` で分岐 |
| `/rating?salon=&staff=` | **有償の評価スタンプ選択**。tier 選択 → `/api/checkout` → Stripe へ。「感想だけ送る」導線あり |
| `/rating/complete?session_id=` | 購入完了。**DB書き込みなし**（記録は webhook 側・二重記録防止） |
| `/mypage` | サロンごとのスタンプカード（円形ロゴ＋スタンプリング＋次の特典までの進捗）。移行 delta を合算。特典の3状態表示 |
| `/help` | **よくある質問・お客様向け（認証不要の公開ページ）**。LINE公式アカウントのリッチメニューから開く導線。データ取得なしの完全静的。「echo が開けない」状態で読む前提なのでセッションを一切参照しない。導線は `/mypage` 下部の1行リンク。末尾から `/help/staff` へ相互リンク |
| `/company` | **echo Labs株式会社のコーポレートサイト（認証不要・公開）**。サービス紹介 / 画面 / 料金 / 導入の流れ / 会社概要 / お問い合わせ。会社概要（`/company#company`）に商号・英文商号・法人番号・本店所在地・設立日・資本金・代表取締役・事業内容・事業年度を掲載。**App Router のページではなく `public/company/index.html` の静的HTML**（同ディレクトリにサロン別の特定商取引法ページ `tokushoho-*.html` もある） |

---

## 2. スタッフの世界

| ルート | 役割 |
|---|---|
| `/staff` | スタッフホーム |
| `/staff/join?token=` | **招待リンクの受け口**。店長が発行したトークンを本人の LINE ログインに紐付ける（新ID/PWは作らない）。「参加する」確認 → `POST /api/staff/bind` |
| `/staff/visit` | **来店受付スキャナ**（ログイン中スタッフ用）。来店記録＋消費型特典の消込・取消。旧LINEカード残高の移行入力もここ |
| `/staff/received/[reviewId]` | **評価/感想の着信を1件表示**。echo flow はカウント単位のみ・¥は持ち込まない |
| `/help/staff` | **よくある質問・スタッフ向け（認証不要の公開ページ）**。カメラ許可・スタッフページのURL・ホーム画面への追加。**スタッフ向けだが認証しない**（`/staff` に入れない状態で読むための情報のため）。導線は `/staff` 下部の1行リンク。末尾から `/help` へ相互リンク |

---

## 3. 受付端末（kiosk・独立PWA）

| ルート | 役割 |
|---|---|
| `/kiosk` | **常設iPad用の来店受付スキャナ**。認可は device cookie のみ（LINEに飛ばさない）。`/staff/visit` と同機能・入口だけが違う |
| `/kiosk/setup?salon=&device=` | start_url。cookie を張り直して `/kiosk` へ 303 |
| `/kiosk/manifest?salon=&device=` | per-salon 動的 manifest（→ `40_decisions.md` §5） |

---

## 4. 管理の世界（サロンUI・ミント）

| ルート | 役割 |
|---|---|
| `/manager/inbox` | 店長Inbox（全員共有 / 店長控え） |
| `/manager/staff` | スタッフ一覧 |
| `/manager/staff/[id]` | スタッフ編集 |
| `/manager/rewards` | 特典設定（最大2件・消費型/状態型の切替） |
| `/manager/visit` | **来店スタンプ設定**。①有効/無効（OFF中も来店は記録され、ONで過去分が反映）②発動ハードル 10〜20回 ③来店後の感想リクエスト 10〜360分・10分刻み |
| `/manager/profile` | 店舗プロフィール（ロゴ円アップ） |
| `/manager/kiosk` | 受付端末の登録・device_token の発行/再発行 |
| `/manager/onboard-qr` | **店頭QR発行**。`/onboard` のQRを印刷・PNG保存できる常設ページ。`visit_token` は安定値なので常設QRに使える |
| `/manager/salon/new` | サロン新規作成。**招待コード必須**（migration 0043・有効なコードが無ければ作成不可） |

---

## 5. オーナーの世界

| ルート | 役割 |
|---|---|
| `/dashboard` | オーナーダッシュボード（独立PWA・`manifest-dashboard.json`） |

**2タブ構成：**
- **日次ビュー** — 今の状態。店舗合計¥／スタッフ別（評価件数・ティア絵文字内訳・リアルボイス・前期間比）。**個人¥なし・スコアなし**
- **HR月次ビュー（echo flow）** — トレンド。echo flow の推移・要ケアアラート・好調/要ケア詳細

**echo flow の判定：**
- 要ケア＝直近2ヶ月連続で前月比マイナス
- 好調＝直近が増加傾向
- 安定＝それ以外
- **絶対件数の閾値では判定しない**（→ `00_philosophy.md` §4.4）

---

## 5.5 echo Labs 運営者の世界（`/admin/*`）

サロンの店長(manager)ではなく、**echo Labs の運営者**だけが入れる層。

| ルート | 役割 |
|---|---|
| `/admin/invites` | サロン招待の発行・管理。一覧／新規発行／「送信済み」の手動チェック／期限切れの復旧 |

- 判定は env **`ADMIN_LINE_USER_IDS`（カンマ区切りの line_user_id）のみ**。DB には持たない＝ `staff.role` には触らない
- 非運営者・未ログイン・env 未設定は **404**（403 は返さない。URL の存在をオラクルにしないため）
- **未設定なら全員が非運営者**（fail closed / `@/lib/admin-guard`）
- メール送信機能は持たない。`sent_at` は運営者の手動チェックのみ

---

## 6. 開発用

| ルート | 役割 |
|---|---|
| `/demo` | **ローカル検証専用**。本番は 404（`DEMO_LOGIN_ENABLED` 未設定） |

---

## 7. API

### 認証
```
GET  /api/auth/line/login      LINEログイン開始（returnTo 保持）
GET  /api/auth/line/callback   コールバック。ロール分岐で着地先を決める
POST /api/auth/line/logout
POST /api/demo/login           ローカル専用
```

### 顧客
```
POST /api/reviews              感想送信（RPC 連携・already_submitted は 200）
POST /api/customer/name        表示名の確定
POST /api/checkout             Stripe Checkout Session を連結アカウント上で作成
```

### スタッフ
```
GET  /api/staff?salonId=       スタッフ一覧
POST /api/staff/bind           招待トークンの紐付け
POST /api/staff/visit          来店記録 / 消込 / 取消 / 移行（action で分岐）
```

### 管理
```
/api/manager/staff             一覧・作成
/api/manager/staff/update      更新
/api/manager/staff/archive     アーカイブ
/api/manager/staff/delete      削除
/api/manager/staff/reissue     招待トークン再発行
/api/manager/staff/counts      集計
/api/manager/rewards           特典 一覧・作成
/api/manager/rewards/update    更新
/api/manager/rewards/delete    削除
/api/manager/visit             来店スタンプ設定
/api/manager/visibility        表示制御
/api/manager/profile           店舗プロフィール
/api/manager/salon/new         サロン作成（招待コードを検証・消費）
/api/manager/kiosk             device_token 発行/再発行
/api/manager/stripe/onboard    Account Links を発行
/api/manager/stripe/refresh    リンク再発行
/api/manager/stripe/return     retrieve して連携状態を同期

/api/admin/invites             サロン招待の発行（運営者のみ）
/api/admin/invites/sent        「送信済み」の手動チェック
/api/admin/invites/restore     期限切れ招待の復旧（期限を14日延長）
```

### Webhook / cron
```
POST /api/stripe/webhook           プラットフォーム側
POST /api/stripe/webhook/connect   Connect 側（Direct Charge のため checkout.session.completed はこちら）
POST /api/line/webhook             LINE
GET  /api/cron/line-push           10分ごと。notification_outbox を push
GET  /api/cron/purge               毎日 18:00 UTC（JST 3:00）。古い login_attempts を削除
```

---

## 8. 環境変数（22・実測）

```
APP_BASE_URL
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SECRET_KEY            ← service_role。@/lib/supabase-admin に隔離
SESSION_SECRET
CRON_SECRET

LINE_CHANNEL_ID
LINE_CHANNEL_SECRET
LINE_MESSAGING_CHANNEL_ACCESS_TOKEN
LINE_MESSAGING_CHANNEL_SECRET
NEXT_PUBLIC_LINE_ADD_FRIEND_URL

STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_CONNECT_WEBHOOK_SECRET

SECURITY_ALERT_LINE_USER_ID
DEMO_LOGIN_ENABLED
DEMO_LOGIN_SECRET

NODE_ENV / VERCEL_ENV
```

⚠️ **秘密値に `NEXT_PUBLIC_` を付けない**（バンドルに焼き込まれ全公開になる）。
