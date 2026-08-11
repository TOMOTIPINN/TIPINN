# echo — 用語とデータモデル（Domain）

> **用語とデータ構造の唯一の正。**
> 本番DBから実測（2026-08-11 時点・14テーブル / RPC 10本）。
> スキーマを変えたらここも直す。
>
> 最終更新: 2026-08-11

---

## 1. 用語定義（最重要・ここが揺れると全部揺れる）

| 用語 | 意味 | 実体 |
|---|---|---|
| **感想 / レビュー** | お客様が担当スタッフへ送る**無償**のフィードバック。4段階の評価・体験タグ・コメント（15〜300字）・共有範囲を含む | `reviews` |
| **評価スタンプ** | お客様が送る**有償**のスタンプ。5段階の価格。買い切り・残高なし・即時送信型 | `rating_purchases` |
| **貯まるスタンプ（感想軸）** | 感想を送ると貯まる無償スタンプ。**1個 / 顧客 / サロン / 日（JST）** | `earned_stamps.count` |
| **来店スタンプ（来店軸）** | 来店を記録すると貯まる。**1日1来店**。店長が有効/無効と発動ハードルを設定できる | `visits` の件数 |
| **特典（reward）** | スタンプが貯まると発動するご褒美。**サロンあたり最大2件** | `rewards` |
| **消費型 / 状態型** | 消費型＝使ったら消える（例：ご褒美SPA）。状態型＝権利・消えない（例：VIPセール対象）。`reward_type`（discount/service/priority）とは**直交** | `rewards.is_consumable` |
| **消込（redemption）** | 消費型特典を実際に使うこと。物理削除せず `voided_at` で取消 | `reward_redemptions` |
| **サイクル（cycle）** | 何回目の特典発動か。感想軸と来店軸で別々に数える | 導出値（→ `40_decisions.md` §2.1） |
| **echo flow** | そのスタッフに届いた評価の**件数**の月次トレンド。¥でも順位スコアでもない | 導出値 |

### 混同しやすいペア

- **rating（1〜4の感想の評価値）** と **rating_purchases（有償スタンプ）** は別物。ルート `/rating` は後者（有償スタンプ選択画面）
- **`/manager/visit`** は来店の記録画面ではなく**来店スタンプの設定画面**
- **`/staff/visit`（ログイン中スタッフ用）** と **`/kiosk`（常設iPad用）** は**同じ来店受付機能の2つの入口**。認可方式だけが違う

---

## 2. テーブル（14）

すべて **RLS 有効・ポリシー0件＝deny-by-default**。
実アクセスは `supabaseAdmin`（service_role）を使うサーバーコードのみ。

### 中核

| テーブル | 列 | 備考 |
|---|---|---|
| `customers` | id, line_user_id, display_name, created_at, line_is_friend, name_confirmed_at … | 中央台帳。個人情報は echo 一元管理（原則7） |
| `salons` | id, name(必須), logo_url, stripe_account_id, created_at, visit_axis_enabled, visit_cycle_size, visit_token, device_token, stripe_details_submitted, stripe_charges_enabled, stripe_payouts_enabled, stripe_connected_at … | 決済可否の判定は **`stripe_charges_enabled` 基準**（`stripe_account_id` は審査未完了でも入る） |
| `staff` | id, salon_id(必須), name(必須), photo_url, created_at, line_user_id, role, invite_token, archived_at … | role: manager / staff |

### 感謝・評価

| テーブル | 列 | 備考 |
|---|---|---|
| `reviews` | id, customer_id, salon_id, staff_id, body, created_at, rating, tags, share_scope | rating 1..4（4=最高/3=よい/2=普通/1=改善）。share_scope: `manager_only` / `everyone`（`either` は廃止済み） |
| `rating_purchases` | id, customer_id, salon_id, staff_id, review_id, tier, amount, stripe_payment_id … | **お金の台帳。残高カラム無し**（原則4） |
| `earned_stamps` | id, customer_id, salon_id, count, updated_at | `unique(customer_id, salon_id)` |

### 来店・特典

| テーブル | 列 | 備考 |
|---|---|---|
| `visits` | id, customer_id, salon_id, visited_on, created_at | `visited_on` は JST 暦日。`unique(customer_id, salon_id, visited_on)`＝1日1来店 |
| `stamp_adjustments` | id, customer_id, salon_id, delta, source, note, created_by, updated_by … | 旧LINEショップカード残高の移行オフセット。`unique(customer_id, salon_id, source)`＝冪等 |
| `rewards` | id, salon_id, required_count, title, created_at, reward_type, is_consumable … | サロンあたり最大2件 |
| `reward_redemptions` | id, customer_id, salon_id, reward_id, visit_id, cycle_axis, cycle_index, redeemed_by, redeemed_at, voided_at, voided_by | cycle_axis: `review` / `visit`。部分unique で同一サイクル1回・1来店1消費 |

### 基盤

| テーブル | 列 | 備考 |
|---|---|---|
| `notification_outbox` | id, customer_id, salon_id, kind, visited_on, notify_at, status, sent_at, skip_reason … | 来店リマインドのキュー。cron `/api/cron/line-push` が10分ごとに push |
| `stripe_events` | id, type, salon_id, payload, received_at, processed_at | webhook の冪等記録（二重配信を最上位で止める） |
| `audit_log` | id, salon_id, customer_id, actor_type, actor_id, action, table_name, record_id, old_data, new_data, created_at | 追記専用。トリガー `fn_audit_log` が自動記録 |
| `login_attempts` | id, scope, ip, succeeded, detail, created_at | 認証試行の記録とレート制限の基盤（→ `50_security.md`） |

**⚠️ 新テーブルを足すときのルール** → `40_decisions.md` §1.6（RLS 自動有効化）と、
お金や顧客の権利に関わるなら `fn_audit_log` トリガーの付与要否を必ず検討する（migration 0034 参照）。

---

## 3. RPC（10）

| 関数 | 引数 | 役割 |
|---|---|---|
| `submit_review_and_earn_stamp` | customer, salon, staff, body, rating, tags, share_scope | 感想挿入＋スタンプ付与を1トランザクションで。戻り: review_id / new_count / `stamp_awarded` / `already_submitted` |
| `submit_visit_and_earn_stamp` | customer, salon | 来店記録＋来店軸カウント。移行 delta を加算 |
| `list_available_consumable_rewards` | customer, salon | 「今この来店で何を消せるか」**本日来店ゲート有り**。cycle 導出の正（スキャナ用） |
| `list_consumable_reward_states` | customer, salon | 「今 権利として残っているか」**ゲート無し**（mypage 用） |
| `redeem_reward` | customer, salon, reward, staff | 消込。失敗は例外でなく `ok=false` ＋ `reason` |
| `get_todays_redemption` | customer, salon | 本日消込済みの最大1件（done 表示用） |
| `void_reward_redemption` | customer, salon, staff | 消込の取消（当日のみ） |
| `fn_audit_log` | — | audit_log 記録トリガー |
| `rls_auto_enable` | — | `create table` 時に RLS を自動有効化するイベントトリガー |
| `purge_old_login_attempts` | — | 古い認証ログの日次削除（cron `/api/cron/purge`） |

**確認済み（2026-08-11）: 同名関数の重複なし。** signature を変えたら必ず再確認する（→ `40_decisions.md` §1.2）。

---

## 4. 主要ルール

### 貯まるスタンプの付与
**1個 / 顧客 / サロン / 日（JST・Asia/Tokyo）。**
その日その(顧客,サロン)で最初の感想送信のときだけ +1。2回目以降は感想は記録されるがスタンプは増えない。

### 感想の重複投稿制限
**1顧客 / 1サロン / JST日 につき1回**（migration 0020）。
判定単位はスタンプと同一＝**staff 非依存**（ALL staff も個別も「その日の1回」）。
既送信は**エラーではなく 200 `{ alreadySubmitted: true }`** で返す（客を責めない）。

### 感想は来店当日のみ
来店の裏付けが無い感想は RPC が `no_visit_today` を raise（farming 対策・migration 0033）。

### 累計来店の定義
**COUNT(visits) + COALESCE(SUM(stamp_adjustments.delta), 0)** の1式に一本化。
SQL 側は `submit_visit_and_earn_stamp`、app 側は `@/lib/stamp-adjustments` が同式のミラー。

---

## 5. 評価スタンプ価格（税込・確定）

| ラベル | 価格 |
|---|---|
| Thank you | ¥100 |
| Grateful | ¥500 |
| Wonderful | ¥1,000 |
| Amazing | ¥3,000 |
| Unforgettable | ¥10,000 |

- 全て税込（消費税 = amount × 10/110）
- `rating_purchases` の CHECK 制約で固定（amount 限定＋ tier×amount のペア固定）
- app 側の正は `@/lib/rating-tiers`
- **価格は echo 側で固定。サロンは金額もパターン数もいじれない**（原則8）
- ⚠️ `docs/ui-v2.2.pdf` は旧価格を表示している。**この表が正**
