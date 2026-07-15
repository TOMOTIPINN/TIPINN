# echo｜作業引き継ぎログ

> 日次の作業引き継ぎ。新しい日を**上に**足す（最新が先頭）。
> 恒久ルール・決定事項は `CLAUDE.md`（単一ソース）へ。ここは「その日やったこと／残タスク」の時系列ログ。

---

## マイグレーション番号メモ
- 最新適用済み: **0024**（`notification_outbox.skip_reason` ＋ CHECK・LINE通知の既感想スキップ観測用）。
- **次に振る番号は 0025。**

---

## 2026-07-15

### 完了

1. **チェックイン画面の「旧カード残数を訂正」ボタンを条件表示化**（残タスクから昇格・実装完了）
   - 動機: 来店受付（`/staff/visit`・VisitScanner）で、旧カード移行済みの顧客に**毎回**「旧カード残数を訂正」ボタンが出ていた。旧カード残数は移行時に一度確定する値で、訂正が要るのは入力ミスに気づく初回付近だけ。使われないボタンの常設が画面ノイズ（echo の「不要なUIは出さない・美しい沈黙」に反する）。
   - **確定仕様**:
     - 表示条件: **移行後 visit（実来店）が2回以下（`postMigrationVisits <= 2`）のときだけ訂正ボタンを表示。3回目以降は隠す。**
     - 移行後 visit 数 = `count(visits where customer_id=… and salon_id=… and created_at > migration.created_at)`。**A案採用＝移行当日のチェックイン（VisitScanner の migrate→record 連続実行）も created_at が移行より後になり visit #1 としてカウントする**（`visited_on` の JST 日付比較は入れない）。
     - 初回移行時刻の基準 = `stamp_adjustments(source='migration').created_at`。**訂正は既存行の UPDATE（0019）なので created_at は不変**＝訂正のたびにカウントがリセットされる問題は構造的に起きない。単一行のため `min()` 不要。
     - **migration 不要**（`stamp_adjustments.created_at`・`visits.created_at` とも既存カラム・追加 index も不要）。着手前に本番で両カラムの実在を REST で確認済み。（※この機能では新規 migration を使わない。当日別途 0024 を切ったのは下記2の LINE 通知スキップ機能。）
   - 実装（コードのみ・DB 変更なし）:
     - `src/lib/stamp-adjustments.ts`: `getMigrationEntry` が `created_at` も select し `MigrationEntry.createdAt` を返す。
     - `src/app/api/staff/visit/route.ts`（`lookup`）: 移行行があれば `visits` を `created_at > migration.createdAt` で count し、`migrationCorrectable = (count <= 2)` を応答に追加。
     - `src/app/staff/visit/VisitScanner.tsx`: `Target` に `migrationCorrectable` を追加し、訂正 UI（編集入力＋「旧カード残数を訂正」ボタン）を `target.migrationCorrectable && (...)` で条件付きレンダー。「旧カード移行済み：N個」の表示行は常に出す（消すのはボタンのみ）。
   - **救済導線について（前回メモの誤りを訂正）**: 「チェックイン画面から消して manager 側に残す」は誤り。**チェックイン画面（`/staff/visit`）自体が manager/スタッフ側の画面でお客様には見えない**。本実装は訂正ボタンを条件付きで隠すだけで、**機能自体（migrate アクションの UPDATE 経路）は生きている**。3回目以降に訂正が必要になったら、そのとき表示条件を緩めるか別導線を検討する（現時点では不要）。
   - **検証**:
     - **ケース#2（実データ確認済み）**: 原さん（CARTA・delta=19・移行後 visit 4回）を、キオスク端末 cookie を発行して**実 lookup エンドポイント経由**で叩き `migrationCorrectable:false` を確認（`getMigrationEntry`→count クエリ→フラグ生成→応答の全経路が動作）。→ ボタン非表示。
     - **ケース#1（コードレビューで担保）**: 移行後 visit ≤2 で `true` を返す境界の反対側。条件式が単純な `<= 2` 比較で、`false` 側が実路経で確認できている以上 `true` 側が返らない理由がなく、本番への一時行 INSERT リスクに見合わないため実データ検証は見送り。条件付きレンダーが `target.migrationCorrectable` に直結していることをコード目視で確認。
     - `npx tsc --noEmit` パス。

2. **LINE通知の既感想スキップを実装**（migration 0024 ＋ cron ワーカー）
   - 概要: 来店リマインド通知（`/api/cron/line-push`）で、その来店日に感想も評価スタンプも送り終えた顧客への「来店ありがとう」リマインドを送らない。
   - **migration 0024**（`0024_outbox_skip_reason.sql`）: `notification_outbox` に `skip_reason text` を追加（NULL 許容＋既知値限定の CHECK：`already_completed` / `stale` / `not_friend` / `no_line_user`）。**SQL Editor で本番適用済み・実在確認済み**（`information_schema` に 1 row / `skip_reason` / `text`）＋ `notify pgrst, 'reload schema'` 実行済み。status（状態機械）は不変。
   - **判定キー**: `reviews`・`rating_purchases` とも `visit_id` を持たない（調査で確認）ため、`outbox.visited_on`(JST暦日) を UTC 範囲 `[当日00:00 JST, 翌日00:00 JST)` に展開して `created_at` を挟む方式。`reviews` が 1顧客/1サロン/JST日につき1件（0020）と綺麗に対応。
   - **skip 条件【厳しめ】**: `reviews` と `rating_purchases` の**両方**が hit したときのみ skip（`already_completed`）。**片方だけなら送信**して残りを促す。立ち上げ期は LINE 原価よりデータ密度を優先。
   - **判定順は「既感想 → 鮮度」**。完了済みかつ鮮度切れは `already_completed` に分類（観測したい本命カテゴリを優先）。
   - **既存の鮮度 skip も理由付与**: `no_line_user` → `not_friend` → `stale` の順に分岐（deliverability の根本ブロッカーから先に）。
   - `mark()` を第3引数 `skipReason` 対応に拡張（デフォルト null で既存呼び出しを壊さない）。`.eq('status','pending')` の二重送信ガードは不変。
   - レスポンス JSON に `skippedByReason: { already_completed, stale, not_friend, no_line_user }` を追加（即時観測）。DB 側は `skip_reason` 列で durable に残る。
   - 実装ファイル: `src/app/api/cron/line-push/route.ts`（`hasReviewAndPurchase()` 追加・ループ再構成・`mark()` 拡張・レスポンス細分化）。
   - **検証**: 本番 pending=0 を確認のうえ、ローカルで authorized 呼び出し → レスポンス形を確認（`{ok, picked:0, sent:0, skipped:0, skippedByReason:{…}, failed:0}`）。非認証は 401。呼び出し前後で outbox 内訳は不変（pending0 / sent9 / skipped1 / failed0）＝書き込みゼロ。既存 skipped 1件は `skip_reason=NULL` のまま維持。`npx tsc --noEmit` パス。
   - **【未検証・要観測】** pending=0 のため skip 分岐の実発火は未確認。8月ドッグフーディングで pending が流れ始めたら `select skip_reason, count(*) from notification_outbox where status='skipped' group by skip_reason` で観測する。
   - **【将来の緩和】** サロン数増で LINE コストが効いてきたら、skip 条件を「どちらか1つ」に緩める（`hasReviewAndPurchase` の `&&` を `||` に変えるだけ）。`skip_reason` の観測データが判断材料になる。

### 残タスク（申し送り）

- （2026-07-12 の残タスクを継続。下記 2026-07-12 セクション参照。）
- ※「LINE通知の既感想スキップ」は本日実装完了（上記2）。handoff 残タスク一覧には明示行が無かったため、削除ではなく完了として本セクションに記録。

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
- ~~チェックイン画面の「旧カード残数を訂正」ボタンを条件表示にする~~ → **2026-07-15 実装完了**（上部セクション参照）。

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
