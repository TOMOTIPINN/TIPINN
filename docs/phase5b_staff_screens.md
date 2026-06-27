# echo｜Phase 5-b 実装スペック（スタッフ向け画面 3本）

> 使い方：このファイルを `~/dev/TIPINN`（リポジトリ直下、例 `docs/phase5b_staff_screens.md`）に置き、
> Claude Code に「このスペックに沿って実装して」と渡す。確定UI（特に通知画面）はデッキ v6 P8 を正とする。
> **着手前に必ず `CLAUDE.md` と Supabase の実スキーマを読み、本書の前提（テーブル名・カラム名）を実体に合わせること。**

---

## 0. 前提（このリポジトリの真実）

- スタック：Next.js 16 (App Router) + Supabase + Stripe Connect (Direct Charge) + Vercel + LINEログイン
- ドメイン：echo-thanks.jp ／ Supabase project：`ztvjwfofznqndqbsnluq`
- 既存テーブル（Table Editor 実物）：`salons` / `staff` / `customers` / `reviews` / `rating_purchases` / `earned_stamps` / `rewards`
- 既存の真実（コード由来・変更不可）：
  - VIP＝`@/lib/vip` の `CYCLE_SIZE` ＋ `computeVipProgress(count)`（サイクル制、`progressInCycle===0` で発火）
  - スタンプ＝1日1個・累計（その日の顧客×サロンで最初の感想送信のみ +1）。絵柄＝サロンの `logo_url`
  - 有料評価＝`/rating?salon=&staff=` → `<RatingPicker>` → `/api/checkout`（Direct Charge・`application_fee=0`・価格はサーバ側が正）
  - tier：Thank you¥100 / Grateful¥500 / Wonderful¥1,000 / Amazing¥3,000 / Unforgettable¥10,000
  - 既存ルート：`/rating`、`/rating/complete`、`/dashboard`（日次⇄HR月次の2タブ）、`/mypage`、`/review/complete`
- **未実装（今回作る）**：`/staff` 配下（現状 `/api/staff` のみ）、店長Inbox、リアルタイム通知

---

## 1. スコープ：スタッフ向け 3画面

| # | 画面 | ルート（案） | 役割 |
|---|------|------------|------|
| 13 | スタッフ通知 | `/staff/received/[reviewId]` | 評価/感想の着信を1件表示。**確定UIはデッキP8** |
| 12 | スタッフホーム | `/staff` | 蓄積（今週/今月/今期の件数・ランク）＋ Team voices |
| 11 | 店長 Inbox | `/manager/inbox` | 声の一覧。全員共有 / 店長控え の2択 |

優先度：**13 →（リアルタイム通知の土台）→ 12 → 11**。13と12は同じデータ源なので近接して実装する。

---

## 2. 8つの絶対原則（§12・スタッフ画面に効くもの）

1. **スタッフに ¥ を一切表示しない**（金額は店舗合計のみ・ダッシュボード側）。通知・ホームは **件数（👍/件）中心**。
2. 赤を使わない。mint＝好調・上昇の差し色。**要ケアは amber（`#C98A3C`）でトレンド判定**（詰めるためでなく育成のため）。
3. スタッフは「評価対象」表記。決済受取先はサロン名。
4. echo flow はカウント単位のみ（金額を持ち込まない）。
5. フォント：本文 **Noto Sans JP（ゴシック）**。英字アクセントのみ Cormorant Italic 可。**明朝は使わない**（スタッフ/オーナー面はダッシュボードの温度感＝mint/ink で統一）。
6. カラー：INK `#12302B` / MINT `#1FB89E` / MINT_DEEP `#0E8F7C` / TINT `#E8F6F2` / TINT2 `#F2FAF8` / GRAY `#6E807B` / LINE `#DCE6E3`。
7. マルチテナント：全クエリ `salon_id` スコープ＋Supabase RLS で越境不可。
8. ポータブル評価グラフ：スタッフ個人に紐づく集計を **`staff_id` 軸**で取れる構造にしておく（将来の人材流通オプションのフック）。

---

## 3. ルート構成（App Router）

```
src/app/
  staff/
    page.tsx                 // 12 スタッフホーム（要ログイン・自分の salon/staff にスコープ）
    received/[reviewId]/
      page.tsx               // 13 通知（1件表示）。確定UI=デッキP8
  manager/
    inbox/page.tsx           // 11 店長Inbox（role= manager のみ）
  api/
    staff/route.ts           // 既存。集計・一覧をここに集約 or 個別 route 追加
```

認証：既存のスタッフ認証（`/api/staff`）を踏襲。`staff.id` と所属 `salon_id` をセッションから解決し、**他サロン・他スタッフのデータは取得不可**にする。

---

## 4. データ取得（実カラムは要スキーマ確認）

- 通知1件（13）：`reviews`（感想本文・タグ・送信日時）＋ 紐づく `rating_purchases`（有料tier・件数）＋ `customers`（表示名）。**金額は取得しても画面に出さない**。
- 蓄積（12）：`reviews` / `rating_purchases` を `staff_id` で集計 → 今週 / 今月 / 今期 の **件数** と ランク（A/B/C…の閾値は仮置きでOK、後で `lib` に切り出し）。
- Team voices（12）：同 `salon_id` 内の新着 `reviews` を数件。「気づきの声」ラベルは低評価/要ケア相当を amber タグで。
- 店長Inbox（11）：`salon_id` 内の `reviews` を新着順。各行に **全員共有 / 店長控え** の可視性フラグ（新カラム `visibility` を `reviews` に追加：`'all' | 'manager'`、デフォルト `'all'`）。

> ⚠️ 金額列（amount等）は**通知・ホーム・Inboxのクエリで select しない**か、selectしても render しない。¥がスタッフ画面に漏れないことをテストで担保。

---

## 5. マルチテナント & RLS（Supabase）

各テーブルに `salon_id` がある前提で、最低限：

```sql
-- 例：reviews。staff も同様に自分の salon_id 範囲に限定
alter table reviews enable row level security;

create policy "staff reads own-salon reviews"
on reviews for select
using ( salon_id = (auth.jwt() ->> 'salon_id')::uuid );

-- スタッフ本人の集計用（自分宛のみ厳格にしたい場合）
create policy "staff reads own reviews"
on reviews for select
using ( staff_id = (auth.jwt() ->> 'staff_id')::uuid );

-- manager のみ Inbox 全件
create policy "manager reads salon inbox"
on reviews for select
using ( salon_id = (auth.jwt() ->> 'salon_id')::uuid
        and (auth.jwt() ->> 'role') = 'manager' );
```

- JWT/セッションに `salon_id` `staff_id` `role` を載せる仕組みを先に固める（既存スタッフ認証に追加）。
- `visibility='manager'` の行はスタッフ本人画面に出さない（Inbox専用）。

---

## 6. 13 スタッフ通知 ＝ 確定UI（デッキ v6 P8 を正とする）

縦1カラム・中央寄せ・余白多め・**細い罫線で区切る**（フィルの箱は最小）。明朝不可・ゴシック。**¥なし**。

```
┌───────────────────────────┐
│      ←  Received          │  ← ヘッダー＋下に LINE 区切り
│                           │
│           ♥（MINT）        │  ← tier由来のアクセント（heart or tier絵柄）
│     Your work echoes.     │  ← MINT・italic・letter-spacing
│      評価が届きました        │  ← INK・bold
│        from 田中様          │  ← GRAY
│   ─────────────────────   │  ← LINE（細罫）
│        あなたへの評価        │  ← GRAY・小
│          ＋3 件            │  ← MINT・特大（数字が主役）／👍は「件」表記でも可
│   ─────────────────────   │  ← LINE
│   Review                  │  ← MINT・italic・小（左寄せ）
│   [カウンセリング][居心地]   │  ← タグ：白地・mint枠・mint文字
│   ┌ TINT2 の角丸カード ──┐ │
│   │ 「今日もカラーの…」   │ │  ← 感想本文・INK
│   └────────────────────┘ │
│   ───── LINE ─────        │
│   累計 145        ランク A  │  ← 蓄積（件数）。左右split
└───────────────────────────┘
```

- 数値は `staff_id` 集計から。`+3` は今回着信分の件数。`累計145` は今週累計。
- 実装後、デッキP8をこの実画面のスクショに差し替える（手順は §9）。

---

## 7. 12 スタッフホーム（要点）

- ヘッダー：`Good morning, {staff.name}。`
- **Your appreciation**：今週 `142` 👍（先週比 `+18`）／今月／今期／ランク。**件数のみ・¥なし**。
- **Team voices**（新着n）：同サロンの新着 `reviews` を数件。「気づきの声」は amber タグ。
- 温度感は §2 のトークンで統一（mint/ink・ゴシック）。

## 8. 11 店長 Inbox（要点）

- 未処理 / 処理済み のカウント。
- 行：絵柄＋担当＋時刻＋顧客＋本文抜粋＋ **[全員に共有] [店長控え]** トグル（`reviews.visibility` 更新）。
- `role='manager'` のみアクセス可（RLS＋画面ガード）。

---

## 9. 受け入れ条件（QA）

- [ ] `/staff`・`/staff/received/[id]`・`/manager/inbox` がスタッフ/店長認証下で表示される
- [ ] **どのスタッフ画面にも ¥ が出ない**（grep `¥`／金額列の render が無いことをテスト）
- [ ] 他サロン・他スタッフのデータが取得できない（RLSで弾かれる）ことをテスト
- [ ] 要ケア相当は amber、赤は不使用
- [ ] 通知画面がデッキP8の構造と一致（ヘッダー→hero→件数→Review→累計）
- [ ] フォントはゴシック（Noto Sans JP）、明朝不使用

---

## 10. Claude Code キックオフ（コピペ用）

```
echo の Phase 5-b（スタッフ向け画面）を実装します。まず CLAUDE.md と Supabase の実スキーマ
（salons/staff/customers/reviews/rating_purchases/earned_stamps/rewards）を読み、本スペック
（docs/phase5b_staff_screens.md）の前提を実カラム名に合わせて確認してください。

次の順で進めます：
1. セッション/JWT に salon_id・staff_id・role を載せる（既存スタッフ認証に追加）
2. RLS：reviews/staff を salon_id スコープに（manager は Inbox 全件、staff は自分宛）
3. /staff/received/[reviewId]（通知）を実装。UIはスペック §6（デッキP8）に厳密準拠：
   mint/ink・ゴシック・¥非表示・細罫線レイアウト
4. /staff（ホーム §7）：staff_id 集計で今週/今月/今期の件数とランク＋Team voices
5. /manager/inbox（§8）：reviews.visibility（'all'|'manager'）を追加し2択トグル

制約（厳守）：スタッフ画面に金額を一切出さない／赤禁止・要ケアはamber／明朝禁止・Noto Sans JP／
全クエリ salon_id スコープ。実装後、各画面のローカルURLを提示してください（デッキ差し替え用スクショを撮ります）。
```

---

## 11. 実装後 → デッキ差し替え

画面ができたら、P6・P7でやった手順で **モック→実画面** に差し替え可能：
1. `npm run dev` → `localhost:3000/staff/received/<reviewId>` 等を開く（IDは Supabase から）
2. DevTools モバイル表示でフルスクショ（PNG）
3. デッキの電話フレームにはめ込み（フレーム・ノッチは残す／開発バッジは消す）
