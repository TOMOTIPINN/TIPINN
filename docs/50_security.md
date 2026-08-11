# echo — セキュリティ（Security）

> **機能追加・変更のたびに確認する不変条件。**
> 2026-07-14 の棚卸しで確定し、2026-08-11 に login_attempts を追記。
>
> 最終更新: 2026-08-11

---

## 1. 変更時チェックリスト

### 1.1 テナント分離は RLS ではなく `salon_id` スコープで担保する

全テーブルは RLS 有効・deny-by-default（直アクセスは全拒否）。
**実分離は、`supabaseAdmin` を使うサーバーコードが `ctx.salon_id` で必ず絞ることで成立している。**

この salon_id は**必ずセッション由来**（`getStaffContext()` → `line_user_id` から `staff` を引いた DB 上の値）。
**リクエストの body / query の salon_id は絶対に信用しない。**

新しく `supabaseAdmin` で読み書きするクエリ・RPC を書くときは、
`.eq("salon_id", vctx.salon_id)` 相当のスコープ（RPC なら `p_salon_id: vctx.salon_id`）を必ず付ける。

> 確認済: `staff-session.ts` が salon_id を DB 由来に固定＝越境不能。

### 1.2 新テーブルを追加したら RLS を確認する

```sql
select tablename, rowsecurity from pg_tables where schemaname='public';
```

**有効化そのものは `ensure_rls` が自動でやるので「忘れる」ことは起きない**（→ `40_decisions.md` §1.6）。
残る仕事は**ポリシーを書くか / 完全deny を意図的に選ぶか**の判断のほう。

新テーブルごとに「読む導線が要るか」を決め、
要るならポリシーを書き、**要らないなら完全deny を意図として migration に明記する**。

> 確認済: 現行14テーブルすべて `rowsecurity=true`。ポリシーは0件＝全拒否で正常。

### 1.3 secret を `NEXT_PUBLIC_` に置かない

`SUPABASE_SECRET_KEY`（service_role・RLSバイパス）は `@/lib/supabase-admin` 経由の**サーバー側のみ**。
env を追加するとき、秘密値に `NEXT_PUBLIC_` prefix を付けない（バンドルに焼き込まれ全公開になる）。

`.env` / `.env.local` は git 追跡しない（追跡は値の無い `.env.example` のみ）。

> 確認済: secret は `supabase-admin.ts` 1ファイルに隔離。`.env` は check-ignore 済。

### 1.4 DB書き込みは共有 `supabaseAdmin` のみ

独自に `createClient` しない。サーバー側のみ。

---

## 2. 認証試行の記録とレート制限

**migration 0037 / 0038 / 0039 / 0040**（割賦販売法セキュリティ・チェックリスト 1-3 / 6 に対応）

```
login_attempts(id, scope, ip, succeeded, detail, created_at)
  index: (scope, ip, created_at desc) / (created_at)
```

### 設計判断
- **RLS ポリシーを1本も定義しない＝完全deny（意図的）**
- 認証試行ログは **service_role からのみ読み書きする**
- **管理画面から閲覧させる導線は現時点で作らない**
- 将来必要になった場合は **security definer RPC 経由**とし、
  **直接 SELECT を許すポリシーは追加しない**

### 付随
- `purge_old_login_attempts()` を cron `/api/cron/purge`（毎日 18:00 UTC ＝ JST 3:00）が実行
- 異常時は `SECURITY_ALERT_LINE_USER_ID` へ通知

> **注意**: 0037 で insert 権限（シーケンスへの USAGE）が不足しており、0039 / 0040 で修正した経緯がある。
> `create table` した新テーブルに service_role が書き込めるか、必ず実際に試して確認すること。

---

## 3. 個人情報の扱い

- **個人情報は echo 一元管理**。サロンは自店データのみ参照できる（原則7）
- QR 生成は `qrcode` で**ローカル生成**（外部送信なし）
- カルテ等の内部メモを将来足す場合は、`staff_notes` として**別テーブルに物理分離**し、
  **客向けエンドポイントから参照しない**ことを鉄則とする（未実装・方針のみ）

---

## 4. 承知の上のトレードオフ

### 4.1 device_token が manifest の start_url に載る
→ `40_decisions.md` §5.4 に詳細。据え置き端末は専用 Apple ID・Safari 同期OFF が推奨。
**共用 Apple ID は不可。**

### 4.2 device_token は salons に1つ＝iPad 3台で共有
1台紛失で再発行すると全端末が失効。3台規模では許容。

---

## 5. 積み残し（いつか閉じる・優先度低）

1. `api/staff/visit` の `customers.display_name` 取得が salon_id 非スコープ
   （UUID 既知なら他店顧客の表示名のみ取得可・機微データは漏れない）
2. `submit_visit_and_earn_stamp` RPC 内の customer↔salon 所属チェック
   （上流で salon_id が固定されるため越境は不能・念のためレベル）

---

## 6. 導入済みの対策

- Malwarebytes
- CodeQL
- Dependabot（削減済み）
- セキュリティ申告書（割賦販売法）対応済み
