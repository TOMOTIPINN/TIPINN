# echo｜作業引き継ぎログ

> 日次の作業引き継ぎ。新しい日を**上に**足す（最新が先頭）。
> 恒久ルール・決定事項は `CLAUDE.md`（単一ソース）へ。ここは「その日やったこと／残タスク」の時系列ログ。

---

## マイグレーション番号メモ
- 最新適用済み: **0023**（`staff.idempotency_key` ＋ フル unique index・招待の二重送信防止）。
- **次に振る番号は 0024。**

---

## 2026-07-12

### 完了

> 1〜5 は 2026-07-11 セクションにも記録あり。ここでは当日の最終確認結果（実店舗数・oid 等）を含めて再掲する。

1. **来店カード非表示バグ修正**（visit_axis_enabled）: DBデフォルトが `false` で新店の来店カードが全顧客に非表示だった。該当サロンを true 化＋デフォルトを true 化（migration **0022**）。**全5店 true を確認済み**。
2. **通知10分刻み化**（notify_after_minutes）: 下限 30→10、10分刻みプルダウン。DB制約 `between 10 and 360 かつ %10=0`。UI/API/型を統一。**実機確認済み・push 済み**。
3. **either 廃止・2値化**: `reviews` の either 2件を `manager_only` に移行（DB手動）。`SHARE_SCOPES` から削除（`src/lib/review.ts` 1ファイル）。Team voices クエリは無改変。
4. **CLAUDE.md 追記**: 表示系 bool フラグのデフォルト値を疑う鉄則（§3・実例 visit_axis_enabled）。
5. **CARTA「たくま」重複スタッフ削除**: 二度押しで2件（3秒差）登録。写真ありの古い方を残し、写真なしを手動 delete。

6. **感想送信の重複関数バグ修正（本日最大）**
   - 症状: `submit_review_and_earn_stamp` が **prod に3バージョン並存**していた。
     - `17711` = 4引数の原始版
     - `17715` = smallint 版
     - `17946` = integer 版・戻り値4カラム（＝正しい 0020 版）
   - PostgREST が候補を一意に選べず **PGRST203** → **全ての感想送信が 500**。returnTo とは別レイヤーの、感想が送れない直接原因。
   - 対応: 古い2つ（`17711`・`17715`）を `drop function`、正しい `17946` のみ残した（DB手動）。
   - 検証: **実機で感想送信成功・DB に1件記録を確認済み**。
   - 教訓は CLAUDE.md §3 に鉄則化（下記8）。

7. **returnTo 欠落修正**（`/review`・`/rating`）
   - 症状: 未ログインで感想フォーム/評価購入を開くと、ログイン後に元ページへ戻れず顧客ホーム `/` に着地し送信に失敗。LINE通知の感想リンク（`/review?salon=...`）から感想が送れない導線バグ。
   - 対応: `salonId` 等を先に読み、`/visit` と同じ方式で元パス（クエリ含む）を returnTo に載せてログインへ飛ばす（**commit `535daf1`・push 済み**）。
   - `rating/complete` は Stripe `success_url` 経由でログイン済み前提のため**対象外**（表示専用・DB書き込みなし）。

8. **CLAUDE.md 追記**（§3・関数 signature 変更事故）
   - 「関数の `create or replace` で引数の型/数を変えると“置き換え”ではなく“新規作成”になり、古い定義が残って同名関数が並存する。PGRST203 や旧版呼び出しを招く」を鉄則化（実例＝上記6の3版並存）。
   - 対策として「RPC signature を変える migration の後は必ず `pg_proc` を select して同名関数が1つか確認」する手順（SQL付き）を明記（**commit `8c51330`・push 済み**）。

9. **関数重複の全数チェック**
   - `submit_visit_and_earn_stamp` と `submit_review_and_earn_stamp` の両方を prod で確認 → **それぞれ1つずつ（クリーン）**。来店側に並存は無し。

### 事業・法務

10. **Stripe KYB（夏井氏回答）**: Stripeアカウント登録に入金用銀行口座の登録は必須だが、**代表者個人名義の口座で暫定登録して審査を進められる**。法人口座開設後にダッシュボードで法人名義へ変更可能。→ **法人口座開設がクリティカルパスから外れた**。登記完了と同時に KYB 開始でき、有償軸の開始が口座開設の遅れに引きずられない。
11. **PayPay 審査期間**: 通常 **2〜3週間**（追加情報要求でさらに延びる）。入金フロー/サイクルはカード決済と同じ。

### 完了（午後・スタッフ二重送信防止）

12. **スタッフ招待の二重送信防止を実装**（commit `2cab672`・push 済み）
    - 発端: 今日 CARTA で「たくま」が3秒差で2件作られ手動 del した、その再発防止。
    - migration **0023**（`staff.idempotency_key uuid` ＋ フル unique index）。
    - `route.ts`: `insert` → `upsert`（`onConflict=idempotency_key, ignoreDuplicates`）。conflict 時は空 `[]` が返るので、**既存行を再取得して同じ `staff_id` / `invite_url` を返すフォールバック**を実装（冪等）。
    - `AddStaffForm.tsx`: ネイティブ form POST → **onSubmit + preventDefault + fetch(JSON)** に全面書き換え。body は state（`name` / `role` / `idempotency_key`）から明示構築。成功後 `setName("")` ＋ 新 idemKey 生成、失敗/catch でも **finally で `setSubmitting(false)`**。
    - 二重送信防止は **submitting ガード（client）＋ idempotency_key unique（DB）の二重**。

13. **【重要な発見】migration 0023 が本番プロジェクト（`ztvjwfofznqndqbsnluq`）に未適用だった**
    - REST が `column staff.idempotency_key does not exist` を返し続けた。
    - 原因: 「0023 適用」とはローカルの **SQL ファイル作成**のことで、**Supabase SQL Editor での手動適用が抜けていた**。
    - 対応: SQL Editor で `alter add column` ＋ `create unique index` ＋ `notify pgrst, 'reload schema'` を実行して本番に適用。REST 再プローブでカラム認識を確認。
    - 教訓: **migration 作成 ≠ 本番適用。SQL Editor 手動適用を必ず先に**（CLAUDE.md §3 に鉄則化）。

14. **【重要なバグ・本日の罠】`disabled` が `name` を POST から脱落させハングする**
    - 症状: localhost UI で新規スタッフ追加すると「作成中…」で永久ハング、DB に行が作られず、dev ログは `400 invalid_name`。
    - 原因: ネイティブ form POST で `<input name="name" disabled={submitting}>` にしていたため、submit 時に `setSubmitting(true)` → 再レンダーで input が disabled 化 → **HTML 仕様で disabled 要素は送信データに含まれず**、`name` がボディから丸ごと欠落 → API が `invalid_name` で 400 → **エラー時に submitting を戻す導線が無くハング**。
    - 対応: 上記の fetch 化で解消（DOM シリアライズ非依存・body を state から構築・失敗時も finally で submitting 解除）。
    - 検証: localhost で3ケース（通常追加＝一覧表示＋QR／別名で2人目＝別 key で +2／二度押し＝DB dedup を REST で実証）全通過。
    - 教訓は CLAUDE.md §3 に鉄則化（下記）。

15. **本番テストデータのクリーンアップ**: 旧コード時代にスマホ本番で二度押しして生まれた「あみ」2件（`feefdcca-2b60-45a2-b8d6-0eea07861f3f` / `b71ae5cc-1d5c-4796-abf1-be1f891c971a`）を、**reviews 参照なし・未紐付け（`line_user_id`/`bound_at` null）を確認の上 DELETE**。

### 完了（夜・スタッフ削除UI）

16. **スタッフ削除UIを実装**（commit `dd97663`・push 済み）
    - **archive（実績あり・退職）と hard delete（実績ゼロ・誤登録）の棲み分け**。各在籍カードに削除導線、確認モーダルに photo / 感想件数 / 評価スタンプ件数を表示。
    - `reviews.staff_id` と `rating_purchases.staff_id` が**両方 0 のときだけ hard delete 可**、どちらか > 0 なら編集ページの archive へ誘導。
    - 新規: `GET /api/manager/staff/counts`（HEAD count）／`POST /api/manager/staff/delete`（実行直前に両方を再カウントするサーバー権威 guard）。
    - **マイグレーション不要**（FK は既に `on delete set null`）。localhost 実機で全ケース確認（両方0で削除成功／実績>0で削除ボタン非表示＆archive誘導／連続削除で毎回確認）。

17. **【バグと修正・その1】モーダルが画面中央に出ず、オーバーレイ（グレー）だけになる**
    - 原因: 祖先の `.animate-in` が持つ `transform: translateY(0)`（`both` fill の残留）が `position: fixed` の**包含ブロック**になり、モーダルがビューポートではなくコンテナ基準で配置され画面外へ飛んでいた。
    - 対応: `createPortal(..., document.body)` で **body 直下**にレンダーして解消（transform 祖先の外＝viewport 基準に戻る）。
    - 教訓は CLAUDE.md §3 に鉄則化。

18. **【バグと修正・その2】連続削除の2回目で確認モーダルがスキップされ即削除される**
    - 原因は単一機序では特定しきれず（各カードは `Card key=staffId` で keyed＝本来は独立 state）、**多層防御で構造的に不可能化**：
      - `handleDelete` 入口で「`open` かつ この開いたセッションの counts が**両方 0**」でなければ `return` する**厳格ガード（核心）**＝確認を飛ばした delete に到達できない。
      - 開くたびに全 state 初期化 ＋ portal に `key={openSeq}`（開くたび新しいモーダルDOM）。
      - 削除成功後 `resetModal()` で完全リセット。
      - 同一 URL `?deleted=1` への push が no-op になり一覧が更新されない問題を **`router.refresh()`** で回避（URL 不変でも server component 再取得）。
      - counts fetch に `cache: "no-store"`。
    - 教訓は CLAUDE.md §3 に鉄則化。

19. スタッフ削除UI は完了（残タスクから削除）。

### 残タスク（申し送り）

- **感想フォームUI**: スタッフをタップした時点で濃い枠にしたい（現状は顔文字を選ぶまで薄い枠）。バグではなく UI 改善。
- **本番スマホ実機での最終確認（PWA＋LINE内ブラウザ環境）**: デプロイ後に、スタッフ追加（通常/二度押し/別名2人目）＋ スタッフ削除（両方0で削除/実績>0でarchive誘導/連続削除で毎回確認）。明日以降で OK。
- **L/MA（個人事業主）に Stripe 本人確認（KYC）を通す打診**: 登記前にやっておく。
- **POP 3店分**（Niii / suco / nun）: CARTA 雛形に各店 QR URL。
- **/dashboard モックデータ撤去**。
- **顧客フォームの share_scope 文言見直し**（either 廃止後の2値）。
- **通知の起点問題**: チェックイン起点だと長時間施術客に早すぎる。8月ドッグフーディングで着信時刻を記録し、経過時間 vs 絶対時刻を判断。
- **個人事業主（L/MA）の特商法表記**: 有償軸を出す際、個人名・住所の表示義務が絡む。顧問弁護士を付けるタイミングで確認。
- **チェックイン画面の「旧カード残数を訂正」ボタンを条件表示にする**（設計メモ）:
  - 症状・動機: 来店受付（チェックイン）画面で、旧カード移行済みの顧客に対しても「旧カード残数を訂正」ボタンが毎回表示される。旧カード残数は移行時に一度確定する値で、日々変動する来店スタンプとは性質が違う。訂正が要るのは移行時の入力ミスに気づいたときだけで、それも初回付近で気づく。実例: 累計来店23回・旧カード移行済み19個の顧客にも毎回訂正ボタンが出ており、使われないボタンの常設が画面のノイズになっている（echoの「不要なUIは出さない・美しい沈黙」に反する）。
  - 表示条件【確定】: 移行後2回のチェックインまで訂正ボタンを表示。3回目以降は隠す。
  - 救済導線: お客様が見るチェックイン画面からは消すが、manager側には訂正手段を残す（3回目以降に後から間違いに気づく稀なケースの救済）。※manager側にどう置くかは実装時に判断。
  - 実装前の要確認: 「移行後のチェックイン回数」を数えられるか。旧カード移行の日時（`migrated_at` 的なカラム）があれば、それ以降の visits を count すればよい。持っていない場合は回数を数える仕組みが必要になるので、スキーマ確認が先。
  - 実装方針: チェックイン画面で訂正ボタンを条件付きレンダリング。移行後 visit 数 <= 2 のときだけ表示。

---

## 2026-07-11

### 完了
1. **来店カード非表示バグ修正**（visit_axis_enabled）
   - 症状: 新規サロンの `salons.visit_axis_enabled` が DB カラムデフォルト `false` で作られ、新店の来店カードが全顧客のマイページに非表示だった。
   - 対応: 既存の該当サロンを true 化（DB手動）＋ カラムデフォルトを true にする migration **0022**（`0022_default_visit_axis_enabled_true.sql`）を適用・push。
   - 教訓は CLAUDE.md §3 に鉄則化（下記4）。

2. **来店後の感想通知を10分刻み化**（notify_after_minutes）
   - 下限 30→10、10分刻みのプルダウン（10〜360・36択）に変更。
   - DB制約 `between 10 and 360 かつ %10=0`（DB手動適用済み）に UI/API/型を統一。
   - `src/app/manager/visit/page.tsx`（select化・NOTIFY_MIN=10・NOTIFY_OPTIONS）と `src/app/api/manager/visit/route.ts`（`%10` 検証追加）。**コード変更のみ・push済み**。

3. **share_scope の either（どちらでも）廃止・2値化**
   - `reviews` の既存 either 2件を `manager_only` に移行（DB手動）。
   - `src/lib/review.ts` の `SHARE_SCOPES` から either を削除。検証（`isValidShareScope`）・型（`ShareScope`）・UI（`ReviewForm` の map）は配列由来で自動連動。
   - Team voices クエリ（`src/app/staff/page.tsx` の `neq('manager_only')`）は無変更。**push済み**。

4. **CLAUDE.md 鉄則追記**
   - §3 に「顧客の表示に関わる bool フラグは新規サロンのカラムデフォルトで決まる。デフォルトが『顧客に見える側』か必ず確認する」を追記（実例＝visit_axis_enabled）。**push済み**。

5. **CARTA「たくま」の二度押し重複を手動削除**
   - 二重登録のうち、写真ありの古い方を残して新しい重複を削除（DB手動）。

### 残タスク（申し送り）
- **［優先］スタッフ作成ボタンの二重送信防止**: submitting 中は disabled にする（今回の「たくま」二重登録の再発防止）。
- **管理画面からのスタッフ削除UI**: 削除時に `photo_url` と review_count を表示して誤削除を防ぐ。staff 削除で `reviews.staff_id` は `on delete set null`。
