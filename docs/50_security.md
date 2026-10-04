# echo — セキュリティ（Security）

> **機能追加・変更のたびに確認する不変条件。**
> 2026-07-14 の棚卸しで確定し、2026-08-11 に login_attempts を追記。
>
> 最終更新: 2026-10-04
>
> **定期診断の実施記録は `docs/55_security-scan-log.md`。**
> このファイルが「守るべき不変条件」、55 が「いつ何を診断して何を直したかの証跡」
> （Stripe「セキュリティ対策措置状況申告書」設問 3-1）。**月次レビューは毎月25日。**

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

> ⚠️ **優先度の高い未対応（次回の最初の作業）**
> この節は本来「優先度低」の積み残しだが、未対応の項目を書く場所がほかに無いため、
> **優先度の高いものはこの囲みに分けて置く**。閉じたら取り消し線で残す。
>
> ~~**A. `/manager/salon/new?created=<サロンID>` の完了画面が、サロンの持ち主を確かめずに来店QRを出す**
> （2026-09-25・Claude Code がコードを読んで発見。**実機・本番では未確認**）。~~
> → **解決済み（2026-09-29・`7f2b650` 修正・本番確認済み）。** 経緯と確認結果は下に残す。
> - `src/app/manager/salon/new/page.tsx` の `if (created) { ... }` の部分は、ログインしていれば
>   query の `created` をそのまま使って `salons` から `name, visit_token` を引き、
>   来店URL（`/visit?salon=&t=<visit_token>`）と QR を表示する。**持ち主かどうか（自分の staff 行が
>   その salon の manager か）を見ていない。**
> - そのため**サロンIDを知っていれば、ほかの店の来店QR（visit_token）が見える**。
>   §1.1「query の salon_id は絶対に信用しない」に反している。
> - この判定は、完了画面を §21 コミット4a の入口チェック（`hasAnyStaffRow`）より**前**に置いた
>   経緯がある（登録直後の本人が完了画面を見られるように）。直すときもその順序は崩さない。
> - **直すときは対照群も確認する**: 持ち主（作った本人＝その店の manager）には今までどおり
>   完了画面が見えること／持ち主でないアカウントでは見えないこと、の両方。
> - **2026-09-29: コード修正済み・実機未確認**（`7f2b650`）。完了画面を出す前に
>   `isSalonManager`（page.tsx 内）で「session の本人 × created のサロン」の組に
>   **在籍中の manager 行**があるかを見る。無ければ created が無いときと同じ流れ
>   （入口チェック → 「すでにスタッフ」の文言 or 入力フォーム）に進み、QR も URL も出さない。
>   **通るのは「そのサロンの manager」で、作成者に限らない**（作成者以外の manager も通る＝許容）。
>   組織のオーナー（`organization_members`）であるだけでは通らない。
>   DB・migration・RLS は変更なし。~~**実機で対照群と攻撃側を確認するまで、この囲みは閉じない。**~~
> - **2026-09-29: 本番確認済み**（`b7e39c2` デプロイ後・原のアカウント。原は CARTA の manager
>   で、carta 組織のオーナー）。
>   - 対照群: `?created=<CARTA のID>` → 店名・QR・来店URLが出た。
>   - 攻撃側: `?created=<Niii のID>`（原は組織のオーナーだが Niii の manager ではない）→
>     QR も来店URLも出ず、「すでにスタッフとして登録されているため…」の表示。
>     **組織のオーナーであるだけでは通らない**ことの確認も兼ねる。
>   - 不正な値: `?created=abc` → エラーにならず、上と同じ表示。
> - **未確認として残す**（判定のコードは同じため、囲みは閉じる）:
>   - staff 行のないアカウントで開いた場合（入力フォーム側に進む想定）。
>   - 実際の新規登録直後の本人に QR が出ること。**次に新しいサロンが登録されるときに確認する。**
> - **`visit_token` の再発行（ローテーション）は今回は行わない。** パイロット5店舗で悪用の兆候を
>   確認しておらず、店頭QRにもともと含まれる値のため。
> - 同じ形の候補の確認は未着手のまま、下の 7 に別項目として残す。

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
7. **URL の ID でデータを引くページの確認（未着手）**
   （2026-09-29・囲みA の調査で候補として挙がった。中身はまだ読んでいない）。
   - `/admin/invites` が囲みA と同じ形の `?created=` を受け取る。入口は `isAdmin`
     （運営者のみ）の想定だが、完了表示の中身は未確認。
   - 公開ページ（`/visit`・`/onboard`・`/review`・`/rating`・`/review/complete`）は設計上
     query の salon ID を受け取る。**それぞれが何を返しているか**（トークン照合があるか・
     公開してよい情報だけか）は未確認。
   - **エラー文言の表の引き方（2026-10-01 追記・未着手）**: `/admin/invites` は `ERROR_MESSAGE[error] ?? …` で
     クエリの `error` をそのまま表のキーに使っており、`Object.hasOwn` で絞っていない。`?error=constructor` のような
     継承プロパティ名だと、文言ではない値が引ける（`/admin/organizations`・5b では `Object.hasOwn` で絞った）。
     同じ書き方は `grep` で `/admin/staff`・`/manager/salon/new`・`/manager/profile`・`/manager/staff/[id]` にもある。
     実際に何が表示されるか・害があるかは未確認。
   - **送信済みの API が存在しない ID でも成功扱いになる（2026-10-01 追記・未着手）**:
     `/api/admin/invites/sent`・`/api/admin/owner-invites/sent` は uuid の形だけを確かめて UPDATE し、
     **更新した行数を見ていない**。存在しない ID でも `error` が無く、何も出ずに一覧へ戻る
     （2026-10-01 に見つかった「送信済みが一度も保存できていなかった」不具合が気づかれなかったのと同じ形・`40_decisions.md` §21 5d）。
   - **`/api/admin/invites` がエラーのオブジェクトをまるごとログに出している（2026-10-01 追記・未着手）**:
     INSERT 失敗時に `console.error(..., error)`。unique 違反のときは PostgREST の `details` に
     `Key (code)=(...)` が入り、**衝突した既存の招待コード（秘密値）がログに残る**と思われる（推測・未確認）。
     衝突は事実上起きない。オーナー招待（`/api/admin/owner-invites`）は `error.code` だけを出している。
   - **`/admin/invites` の画面が描画中に `Date.now()` を呼んでいる（2026-10-01 追記・未着手）**:
     lint（`react-hooks/purity`）で止まる。動作への影響は未確認。オーナー招待の画面（5d）は
     データを引く関数の中に移して回避した。
   - ~~**★優先度高め★ `notifyRateLimitHit` が、制限に当たるたびに毎回 LINE を送る（2026-10-01 追記・未着手）**~~
     → **コードで対処済み（2026-10-01・`d5d0b8f`・`593bbcc`）・本番での発火は未確認**。
     - **元の問題**: 同じ scope・同じ IP の通知をまとめる仕組みが無く、止められたリクエストは `recordAttempt` されないので、
       止まっている間リクエストのたびに1通ずつ送られていた。4つの入口（line_callback・staff_bind・demo_login・owner_join）に共通。
       **運営者への通知はお客様への来店リマインドと同じ Messaging チャネル**（`LINE_MESSAGING_CHANNEL_ACCESS_TOKEN`・同じ `pushText`）を使うことを
       コードで確認した＝**同じ月の配信枠を使う**。
     - **判断の根拠**: LINE は**ライトプラン（月5,000通・超えると送信が止まる）**。直近30日のお客様への通知は**約935通**（`/admin/salons`・2026-10-01）。
       `notifyPushFailures` だけでも10分ごとの cron で最大1日144通＝月4,000通を超え得る。
     - **対処**（`src/lib/security-alert.ts`・判定は純粋関数の `src/lib/operator-alert-budget.ts`・記録の読み書きは `src/lib/login-attempts.ts`）:
       - レート制限の通知は、**同じ scope・同じ IP には1時間に1回**まで
       - 運営者への通知のうち**レート制限と push 失敗は合わせて1日10通（JST）まで**。**10通目の本文に止める旨を添える**
       - **二重決済（`notifyDuplicateReviewPurchase`）と配信数の警告（`notifyQuotaNearLimit`）は上限の対象外**
         （攻撃者がタダで増やせない＝実際の支払いが要る／1日1通。止まると困る＝返金のきっかけ／枠の警告）
       - **Stripe の連結アカウントの異常（`notifyStripeAccountIssues`・種類 `stripe_account_issue`）も上限の対象外**（2026-10-04 追加・`40_decisions.md` §7.2）。
         Stripe の署名付き webhook からしか出ないので攻撃者が増やせない／止まると入金の失敗・提出物の期限切れに気づけない。
         代わりに**同じ連結アカウント・同じ種類は24時間に1回まで**（`login_attempts` の detail `stripe:<acct_id>:<種類>` で判定。
         **読み取りに失敗したら送る**）。本文に `acct_...` を入れる（`pi_...` と同じ理由の例外）。
         **本番での確認: ア（入金の失敗）・イ（停止）は 2026-10-04 に確認済み・ウ（提出物の期限切れ）は未確認**（`40_decisions.md` §7.2）
       - 送るたびに `login_attempts` に1行記録（scope `rate_limit_alert`・`operator_alert`・`operator_alert_uncapped`）。**migration なし**
       - **判定・記録で DB に失敗したら、上限の対象は送らない**（配信枠を守る側・2026-10-01 決定）
       - 同時に届いた通知は、上限や1時間に1回を**1〜2通超えることがある**（数える・記録する・送るが原子的でない。migration を作らないため）
       - 4つの入口の呼び出し側は変更なし
     - **確認方法**: `scripts/check-operator-alert-budget.mjs`（`node --experimental-strip-types` で実行・**ローカル・DB と LINE を使わない**）。
       本番の DB に試験用の行は入れていない。**本番で実際に発火したときの動き（1時間に1回・1日10通）は未確認**。
     - **検討事項（未決）**: 外部サロンが増えると、共有の配信枠（月5,000通）が先に詰まる
       （直近30日の約935通から単純計算で**25店舗前後**・推測）。**外部展開の前にプランの見直し時期を決める。**
8. ~~**0046 の `submit_review_and_earn_stamp` を anon / authenticated が EXECUTE できるかもしれない（未着手・推測・未確認）**~~
   （2026-10-01・0050 の下書き中に気づいた）。0046 は `revoke all ... from public` だけで、
   anon / authenticated からは revoke していない（0038＋0040・0050 は `from public, anon, authenticated`）。
   関数の既定の権限付与（`pg_default_acl` の `defaclobjtype = 'f'`）で anon / authenticated に
   EXECUTE が付いていれば残っている。0049 はテーブルの既定値だけを塞いでおり、関数には触っていない。
   **確認方法**: `has_function_privilege('anon', 'public.submit_review_and_earn_stamp(uuid, uuid, uuid, text, integer, text[], text)', 'EXECUTE')`
   （authenticated も同じ）と、`pg_default_acl` の `f` の行。ほかの RPC も同じ形か合わせて見る。
   → **確認済み・問題なし（2026-10-02・本番の SQL Editor で読み取りクエリにより確認）。**
   - `submit_review_and_earn_stamp(uuid, uuid, uuid, text, integer, text[], text)` は **security definer**・
     owner は **postgres**・`proacl` は `{postgres=X/postgres, service_role=X/postgres}`。
     **anon / authenticated は EXECUTE 不可**。同名の関数は1つだけ。
   - **public スキーマの全関数（`prokind = 'f'`）で、anon または authenticated が EXECUTE できるものは 0 件**。
   - **未確認として残す**: 既定の付与が付いていない理由（default privileges の設定か、個別の revoke か）。
     このため**新しい関数を作ったときは同じクエリで確認する**。
9. **`robots.txt` と noindex の指定がない（2026-10-02・事実の記録のみ）。**
   `public/robots.txt`・`src/app/robots.ts` が無く、`public/company/*.html` にも noindex は無い。
   検索エンジンに載せたくないページ（運営者画面は 404 を返すので対象外）の扱いを含め、**対応するかは未決**。

---

## 6. 導入済みの対策

- Malwarebytes
- CodeQL
- Dependabot（削減済み）
- セキュリティ申告書（割賦販売法）対応済み

**各ツールの体制と、実施のたびの結果は `docs/55_security-scan-log.md` に記録する**
（月次レビュー＝毎月25日。2026-09-23 に「毎月第1日曜」から変更）。
**未解消の指摘は 55 側に「未解消」として残す**方針で、このファイルの §5 積み残しとは別枠。

### 6.1 Claude Code が `stripe` コマンドを実行できないようにした（2026-10-02・運用メモ）

- `~/.claude/settings.json` の `permissions.deny` に `Bash(stripe *)` と `Bash(/usr/local/bin/stripe *)` を追加した。
  理由は **Stripe CLI の設定に live の制限付きキーがある**ため（Stripe 利用規約 1.7 AI Agent 条項・2027-01-06 適用）。
  原が自分のターミナルで打つ `stripe` は今までどおり使える。
- 追加後、Claude Code からの `stripe --version`・`/usr/local/bin/stripe --version` が拒否されることを確認した。
- **リポジトリの外の設定**なので、**Mac を替えると消える**。
- **deny はセキュリティ境界ではない**（`sh -c` などは防げない）。**事故防止の柵**として入れた。
