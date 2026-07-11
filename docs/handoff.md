# echo｜作業引き継ぎログ

> 日次の作業引き継ぎ。新しい日を**上に**足す（最新が先頭）。
> 恒久ルール・決定事項は `CLAUDE.md`（単一ソース）へ。ここは「その日やったこと／残タスク」の時系列ログ。

---

## マイグレーション番号メモ
- 最新適用済み: **0022**（`salons.visit_axis_enabled` のデフォルトを true 化）。
- 旧メモの「0022=通知」は消化済み（通知10分刻み化はコード変更のみでマイグレーション不要だった）。
- **次に振る番号は 0023。**

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
