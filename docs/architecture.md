# tipinn（チッピン）- システム設計書

## 1. プロジェクト概要

日本の美容室に「感謝の循環（チップ文化）」を導入するWebアプリ。
QRコード読み込み → 応援（チップ）送金のフローを、ユーザー登録不要・アプリDL不要のWebブラウザ完結型で実現。

## 2. システム構成

### フロントエンド
- **Next.js 14** (App Router)
- **PWA対応** (next-pwa)
- モバイルファースト設計

### バックエンド
- **Next.js API Routes** (サーバーレス)
- **Supabase** (PostgreSQL + Auth + Realtime)

### 決済
- **PayPay Web Payment API** (App Invoke)

### インフラ
- **Vercel** (フロントエンド + API)
- **Supabase** (DB + 認証)

## 3. データベース設計 (Supabase)

### salons テーブル
| カラム | 型 | 説明 |
|--------|------|------|
| id | uuid | PK |
| name | text | サロン名 |
| slug | text | URL用スラッグ |
| logo_url | text | ロゴ画像URL |
| created_at | timestamp | 作成日時 |

### stylists テーブル
| カラム | 型 | 説明 |
|--------|------|------|
| id | uuid | PK |
| salon_id | uuid | FK → salons |
| name | text | スタイリスト名 |
| slug | text | URL用スラッグ |
| avatar_url | text | 顔写真URL |
| message | text | 応援のお願いメッセージ |
| thank_you_message | text | 感謝メッセージ |
| is_active | boolean | 有効フラグ |

### tips テーブル
| カラム | 型 | 説明 |
|--------|------|------|
| id | uuid | PK |
| stylist_id | uuid | FK → stylists |
| amount | integer | 金額（円） |
| message | text | 応援メッセージ |
| sender_name | text | 送信者名（任意） |
| payment_id | text | PayPay決済ID |
| status | text | pending/completed/failed |
| created_at | timestamp | 作成日時 |

## 4. 画面遷移フロー

```
QRコード読み込み
    ↓
/:salon/:stylist (ランディングページ)
    ↓ [応援する] ボタン
/:salon/:stylist/tip (チップ選択)
    ↓ [PayPayで応援する] ボタン
PayPay App Invoke (外部)
    ↓ コールバック
/:salon/:stylist/thanks?id=xxx (サンクスページ)
```

## 5. URL設計

| パス | 説明 |
|------|------|
| `/:salon/:stylist` | スタイリスト個別LP |
| `/:salon` | サロン全体（箱推し）LP |
| `/:salon/:stylist/tip` | チップ選択画面 |
| `/:salon/:stylist/thanks` | サンクスページ |
| `/admin` | 管理ダッシュボード |
| `/api/payment/create` | 決済作成API |
| `/api/payment/callback` | PayPayコールバック |
