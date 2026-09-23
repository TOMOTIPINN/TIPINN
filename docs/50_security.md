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
3. ~~**`public` のテーブルで `anon` / `authenticated` に `TRUNCATE` / `TRIGGER` / `REFERENCES` が付いている**
   （2026-09-23・0048 の新テーブルで確認。既存テーブルも同じ状態と推測・未確認）。~~
   → **解消（2026-09-23・migration 0049 適用済み）。**

   **月次セキュリティ診断で全体像が判明した**: 付いていたのは新テーブルだけではなく
   **public の全17テーブル**で、ACL は `Dxtm`（D=TRUNCATE / x=REFERENCES / t=TRIGGER /
   **m=MAINTAIN**）。**原因は postgres の既定の権限付与**
   （`pg_default_acl`: defaclrole=postgres / defaclnamespace=public / defaclobjtype=r で
   anon=Dxtm / authenticated=Dxtm）で、`create table` するたびに自動で付いていた
   ＝テーブルごとの GRANT ではなかった。

   **0049 で両方を塞いだ**: 既存17テーブルからの `REVOKE` と、
   `alter default privileges for role postgres in schema public` での既定値の修正。
   MAINTAIN は PG17 で追加された権限なので、`server_version_num` を見て
   動的 SQL で権限リストを組み立てている（本番は **Postgres 17.6**）。

   **適用後の確認（2026-09-23 18:22）**: public のテーブルに anon・authenticated の
   grant は0件 ／ `pg_default_acl`（public / tables / postgres）は postgres と
   service_role のみ ／ service_role は17テーブルすべてで権限あり ／
   anon・authenticated の実効 TRUNCATE は17テーブル中0 ／
   `/manager/staff` のプロフィール保存（`staff` の UPDATE）が通ることを実機で確認。

   **残る判断**: §1.2「新テーブルを追加したら RLS を確認する」に**権限の確認も足すか**は
   **未決**。0049 で既定値を塞いだので新テーブルには付かなくなったが、
   チェックリストに1行足すかは決めていない。
   **PUBLIC への grant の有無**は今回の対象外で、**未確認**のまま。
4. **`grant` で `delete` を外しても、`service_role` には既定で `DELETE` が付いている**
   （2026-09-23 確認）。0043 / 0048 が `grant select, insert, update` に留めているのは
   **意図が効いていない**。**実害はない**（`service_role` は元から全権）が、
   「権限で絞ったつもり」になっている点が誤解を生む。
   **状況は変わっていない**（2026-09-23 の 0049 適用後も同じ）。
   0049 は anon / authenticated だけを対象にしており、**service_role は全権で運用する前提**
   （アプリの全 DB 操作が service_role を通るため・§1.4）。この項目はそのまま残す。
5. **サロン作成処理（`/api/manager/salon/new`）にレート制限がない**
   （`/api/staff/bind`・LINE callback は `login-attempts` で絞っているが、この経路だけ無い）。
   有効な招待コードが必須なので総当たりの価値は低いが、
   **コミット4・5（組織指定の必須化・オーナー招待）で検討する**（→ `40_decisions.md` §21）。
6. **`/api/manager/staff/archive` に「最後の manager はアーカイブできない」ガードが無い**
   （2026-09-23・§21 の「nun」行の調査で判明）。
   このルートは `archived_at` を更新するだけで、manager の残数を見ていない
   （`requireManager()` ＋ `.eq("salon_id", ctx.salon_id)` の越境ガードはある）。
   **店長1人の店舗でその人をアーカイブすると、誰も店長画面に入れなくなる**
   （`staff-session.ts` が `archived_at is null` を要求するため、本人も締め出される）。
   `/api/admin/staff/transfer` と `/api/admin/staff/role` には `last_manager` ガードがあり、
   **archive だけ非対称**。
   復旧は運営者が SQL か `/admin/staff` 側から行うことになる（画面からは戻せない）。
   **実害は未確認**（発生の記録なし。現在 manager 1人の店舗は DEMO と SELNI）。

---

## 6. 導入済みの対策

- Malwarebytes
- CodeQL
- Dependabot（削減済み）
- セキュリティ申告書（割賦販売法）対応済み
