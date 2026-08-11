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

3. **/dashboard モックデータ撤去 → 完了**（残タスクから削除）
   - 調査結果: `/dashboard`（manager 専用・数字管理／画面14系）のモックは**すでに撤去済み**だった。`0bc3666 feat(dashboard): manager認証ガード＋実データ接続` で実データ化されており、`dashboard-data.ts`（server / supabaseAdmin）が `salons`/`staff`/`reviews`/`rating_purchases`/`earned_stamps`/`customers` を salon_id スコープで集計し、`DashboardClient`/`StaffPeriodView`/`HrFlowView` は props を描画するだけ（ハードコード値・ダミー配列なし）。`eval-data.ts` は旧mock層の名残だが今は型＋純粋関数のみ（データを持たない）。
   - 残っていたのは `page.tsx` の**陳腐化コメント2行だけ**（「モック画面」「中身のデータは…モックのまま」＝実態と食い違う虚偽）。本日これを「実データ（dashboard-data.ts が salon_id スコープで集計）を描画」に修正して完了。`eval-data.ts:2` の「（旧: mock データ層）」は正確なので不変。
   - コメント修正のみ・DB 変更なし・push 済み。
   - **補足（範囲外・認識合わせ）**: `scripts/demo-seed.sql` で **【DEMO】echo デモサロン**に seed が入っているのは意図的（`/demo` ペルソナ導線用）。`/dashboard` は demo ユーザーでも seed 済みサロンの**実集計**を出すだけで、コードにモックを注入する分岐は無い。これはデモ用の正規データなので「撤去」対象ではない。

4. **顧客フォームの share_scope 文言見直し → 完了**（残タスクから削除）
   - 調査結果: either 廃止（0712）後の**3択残骸は無かった**。`ReviewForm` は `SHARE_SCOPES.map()` で描画しており、`review.ts` から either を消した時点で**自動的に2チップに連動**していた。フォーム内に either 前提の対比説明文も無し。
   - 実際の問題は文言の2点: (a)「全員に」が「他のお客さんにも公開？」と誤読される余地（実際はお店のスタッフが Team voices で読むだけ・外部公開ではない）。(b) 宛先フィールドの「お店のみんなへ」と共有範囲の「全員に」で**「みんな／全員」が2箇所・別概念**（宛先 vs 可視性）に使われ混同を招いていた。
   - 対応: `everyone` のラベルを **「全員に」→「お店のスタッフに」** に変更（`src/lib/review.ts` の `SHARE_SCOPES`・単一ソース）。「お店の」で外部公開でないことを示し、宛先の「お店のみんなへ」と語を差別化。`manager_only` は「店長のみ」のまま不変。**補足文は追加しない**（echo の「余計なものを出さない」思想）。
   - manager 側の語彙（「全員に共有／店長控え」）は不変＝顧客側とは別語彙だが、顧客向けは誤読防止を優先。
   - あわせて掃除: `staff/page.tsx:154` の stale コメント（既に存在しない値 `either` を引き合いに出す説明）を2値前提に更新。
   - **DB 変更なし**（値 `manager_only`/`everyone` は不変・移行は 0712 完了済み）。表示テキストのみ。影響は顧客フォームに限定（`SHARE_SCOPES` を import するのは `ReviewForm` だけ）。
   - **検証**: localhost で `echo_session` を発行して `/review?salon=` を開き、共有範囲チップが「店長のみ」「お店のスタッフに」の2つで、旧ラベル「全員に」が消えていることを HTML で確認（2サロンで確認）。`npx tsc --noEmit` パス。

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
- ~~/dashboard モックデータ撤去~~ → **2026-07-15 完了**（上部セクション参照）。
- ~~顧客フォームの share_scope 文言見直し（either 廃止後の2値）~~ → **2026-07-15 完了**（上部セクション参照）。
- **通知の起点問題**: チェックイン起点だと長時間施術客に早すぎる。8月ドッグフーディングで着信時刻を記録し、経過時間 vs 絶対時刻を判断。
- **個人事業主（L/MA）の特商法表記**: 有償軸を出す際、個人名・住所の表示義務が絡む。顧問弁護士を付けるタイミングで確認。
- ~~チェックイン画面の「旧カード残数を訂正」ボタンを条件表示にする~~ → **2026-07-15 実装完了**（上部セクション参照）。
- **特典の消費型/状態型対応＋使用記録**（設計メモ・2026-07-15 調査時点で仕様確定・未実装）:

  **■ 現状の問題**
  MY echo の「もらえる特典」のチェックマークは、権利保有を示すだけの装飾（`globals.css` の `.perk-item::before` の ✓・全 title に常時付く）で、使用は記録されていない。`/staff/visit` が返すのは名前・累計来店・VIP・移行状態のみで、スタッフが「この顧客がこの特典を使ったか」を知る手段が**存在しない**。同じサイクルで何度でも使われうる。使用記録テーブル・カラム・コードはゼロ（§7 の「07 特典解除 / 08-09 特典使用」も未実装）。

  **■ 実現したい仕様（すべて確定済み）**
  1. **特典を2種類に分ける**
     - 消費型（consumable）：ご褒美SPA[10min] のようなサービス。使ったらチェックが外れる。
     - 状態型（standing）：VIPセール対象のような権利。VIPである限りチェックが付き続ける。使っても消えない。
  2. **reward_type（discount/service/priority）では消費/状態は決まらない。両者は直交する**
     - 例：DEMO の「次回カラー10%OFF」= discount だが消費型。「VIP会員は常に10%OFF」なら状態型の discount。service も「毎回ドリンク無料」なら状態型。
     - 【確定】`rewards` に `is_consumable boolean` を追加（`perk_kind` text 3値超ではなく bool。2値で足りるため。将来3値目＝回数券型などが必要になったら text に移行）。
     - 【UI】`manager/rewards` には既に「特典の種類」プルダウン（割引/サービス/優先＝reward_type）がある。その選択肢を増やすのではなく、**独立した項目**として消費/状態を追加（例：「1回きり / ずっと有効」）。理由：reward_type と直交するので「割引×消費型」「サービス×状態型」も表現できる必要がある。
  3. **軸の設計【確定】**
     - 感想軸：感想3件ごとに1個（サイクル型・リセットして繰り返す）。
     - 来店軸：来店20回ごとに1個（別カウント）。
     - 両軸は独立して積み上がる。例：20回来店で20回感想を書いた人は、感想軸で floor(20/3)=6個 + 20回目の来店特典で計7個。
     - 設計意図：感想は書かない人もいる想定なので、書いてほしくて3回に設定。来店は来れば必ず何か提供する。
  4. **軸ごとの適用範囲【確定】**
     - 消費型（サービス）：**両軸共通**。感想3件で1回、来店20回で1回、それぞれ独立に発生。特典の中身は同じ。
     - 状態型（権利）：**感想軸のみ**。20回来店しただけの人には VIP セールのような権利は付かない。
     - 理由：サービスは来店への報酬、権利（VIP という資格）は感想を書いてくれた人＝echo に貢献した人への報酬。
     - 【軸の持ち方＝導出で確定】`rewards` に軸の列は持たせない。`is_consumable` から導出する（消費型→両軸 / 状態型→感想軸のみ）。理由：この対応は設計思想に由来しており恣意的でないため崩れにくい。また店長の特典設定 UI で選ばせる項目を減らせる。
     - 【重要】導出箇所のコードに必ず理由をコメントで残すこと：「消費型=サービス=来店への報酬なので両軸／状態型=権利=感想への報酬なので感想軸のみ。この対応は設計思想に由来する。将来これが崩れる要望（例：来店20回の人にも状態型の権利を与えたい／感想を書いた人だけの消費型サービスを作りたい）が出たら、`rewards` に `axis` 列を追加して明示的に持たせる方向に移行する」。
  5. **使用の運用フロー【確定】**
     - お客様がチェックイン → スタッフの受付画面に「SPA 使えます」が見える → スタッフから「特典がありますので本日使用させていただきます」と声かけ → その場でスタッフがチェックを外す（redeem 記録）。
     - 施術後ではなく**受付の場で消す**ことで、消し忘れを減らす。
     - 軸の区別はスタッフにも顧客にも見せない。どちらの軸由来かはシステム内部で記録するだけ。
     - 消込は必ずスタッフが受付画面で行う。顧客の自己申告は濫用・誤操作に弱いため**不採用**。
  6. **表示と回数の扱い【確定】**
     - 回数は出さない。「使える/使えない」だけを表示する。
     - 1来店につき消費型は**最大1回**まで。両軸で2回分立っていても、その日使えるのは1回。残りは次回の来店に持ち越し。
     - 理由：同日に2回分（感想3の倍数 かつ 来店20の倍数）が重なるのは稀。「あと2回」と出すと今日2回使えると誤解される。
     - → 実装上「同一来店で消費型を redeem 済みか」のガードが必要。cycle_axis 別の unique 制約とは別軸の判定。1日1来店（JST 日付ユニーク）なので `redeemed_at` の JST 日付で判定できるか要検討。
     - 顧客 MY echo：消費型は「使える=✓ / 使用済み=褪せグレー・✓なし」で出し分け（状態型は常時✓）。§12「赤禁止・褪せグレー」に準拠。
     - スタッフ受付画面：使える状態の消費型を表示 → タップで消込。その来店中はもう出ない。
  7. **既存2件のデフォルト【確定＝案A】**
     - migration では一律 `is_consumable = false`（状態型）で列を追加する。
     - 理由：適用直後はまだ消込 UI が無いので、全部状態型＝現状の挙動のままにしておけば何も変わらない。実装が全部載って、テストして納得してから、`manager/rewards` の画面で「ご褒美SPA」を「1回きり」に切り替える。切り替えは実装完了の最終ステップであり、忘れる類のものではない。問題があれば「ずっと有効」に戻せば元通り。
     - 「service→消費型 / priority→状態型」の自動振り分けは**採用しない**（reward_type と消費/状態は直交するという方針2と矛盾するため）。

  **■ 必要な変更（調査済みの見立て：中〜やや大・小改修ではない）**
  - **migration 0025**：`rewards` に `is_consumable boolean`（default false）追加、`reward_redemptions` テーブル新設（RLS deny-by-default + index）。
    - `reward_redemptions(customer_id, salon_id, reward_id, cycle_axis, cycle_index, redeemed_by, redeemed_at)`
    - `unique(customer_id, salon_id, reward_id, cycle_axis, cycle_index)` ← `rewards` に軸列は持たないが、redemption は**どちらの軸で使ったか**を記録する必要がある。
  - `src/lib/rewards.ts`：`SalonReward` に `is_consumable` 追加・select 拡張。
  - 新 `src/lib/reward-redemptions.ts`：現サイクルで使用済みか読取・使用記録の書込（salon_id スコープ）・同一来店ガード。
  - `src/app/mypage/page.tsx` + CSS：消費型の使用済み表示（褪せグレー）。
  - `/staff/visit` + `api/staff/visit`：消費型特典に「使う」アクション（redeem 記録）＋使用状態表示。
  - `/manager/rewards` + api：特典設定に消費/状態（`is_consumable`）の選択を追加。既存の「特典の種類」プルダウンとは別項目。
  - `vip.ts`：`cyclesCompleted` は既にあるので流用可。

  **■ 運用リスク【着手前に方針を決める】**
  - 消込忘れのリスク：スタッフが SPA を提供したのにチェックを外し忘れると、次回来店時に別のスタッフが「特典があります」と再提供してしまう。
  - 現在の想定フロー（受付の場で声かけしながらその場で消す）は施術後に消すより忘れにくいが完全ではない。
  - 検討すべき対策：
    - (a) 消込を来店記録とセットにする（チェックイン時に「特典を使う」を選ぶと来店記録と同時に消込。ただし「今日は使わない」選択も残す必要あり）。
    - (b) 消し忘れ検知（前回使える状態のまま来店記録がある＝消し忘れの可能性を警告。ただし「本当に使わなかった」ケースと区別できない）。
    - (c) UI 設計で忘れにくくする（受付画面で特典を目立たせる等）。
  - この論点は migration のデフォルト値より重要。**実装着手前に方針を決めること**。

  **■ 残る実装判断（着手時に決める）**
  - 同一来店ガードの実装方法：`redeemed_at` の JST 日付で判定するか、`reward_redemptions` に visit を紐づけるか。
  - 両軸で2回分立っているときの消込順序ルール（感想軸から先に消す等）。

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
