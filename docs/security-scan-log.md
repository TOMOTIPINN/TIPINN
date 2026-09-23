# 脆弱性診断 実施記録（echo / TIPINN）

> Stripe「セキュリティ対策措置状況申告書」設問 3-1「脆弱性診断の定期実施」の証跡。
> 本ファイルは診断のたびに追記する（過去の記録は書き換えない）。

- 対象システム: echo（Next.js / Supabase / Stripe Connect Direct Charge）
- リポジトリ: `github.com/TOMOTIPINN/TIPINN`
- 記録開始: 2026-08-02

> **置き場所について（2026-09-23）**: このファイルは一時 `docs/archive/` に置かれていたが、
> archive は「その時点の記録・書き換えない」場所であるのに対し、**本ファイルは追記し続ける台帳**
> なので `docs/` 直下へ移した。**過去のエントリは書き換えない**という方針（§6）は変わらない。

---

## 1. 診断体制

以下の4本立てで、自動診断（常時）＋ 人手による定期レビュー（月次）を実施する。

| # | ツール | 対象 | 実行契機 | 確認者の作業 |
|---|---|---|---|---|
| 1 | **GitHub CodeQL** | 自社コードの静的解析（SAST） | push / PR ごとに自動 | 月次レビューで open alert を確認 |
| 2 | **GitHub Dependabot** | 依存パッケージの既知脆弱性（SCA） | 常時・自動検知 | 月次レビューで件数と深刻度を確認し、対応要否を判断 |
| 3 | **Supabase Security Advisor** | DB 側の設定（RLS・権限・関数のセキュリティ属性） | 手動実行 | 月次レビューで Errors / Warnings を確認 |
| 4 | **Malwarebytes** | 開発端末（macOS）のマルウェア | 毎日 9:00 スケジュール実行 | 月次レビューで直近の検出履歴を確認 |

**月次レビュー日: 毎月第1日曜。** 当日に上記4件を確認し、本ファイルへ結果を追記する。
Dependabot・CodeQL は自動検知のため、緊急度の高い指摘は月次を待たず随時対応する。

---

## 2. 2026-08-02 第1回定期診断

- 実施日: 2026-08-02（日）
- 実施者: 原 朋之
- 診断時点のコミット: `645ca8b` → 対応後 `e6f1e38`

### 2-1. CodeQL（静的解析 / SAST）

| 項目 | 件数 |
|---|---|
| Open | **0** |
| Closed | 1 |

未対応の指摘なし。

### 2-2. Dependabot（依存パッケージ / SCA）

診断時 **33件**（high 18 / moderate 12 / low 3）。

**対応:** Next.js を 16.2.4 → 16.2.12 に更新し、**22件を解消**。

| commit | 内容 |
|---|---|
| `c92fe1a` | `next` 16.2.4 → 16.2.12 |
| `e6f1e38` | `eslint-config-next` 16.2.4 → 16.2.12（next とバージョンを揃える） |

**残存 11件**（対応後・high 7 / moderate 3 / low 1）:

| パッケージ | 件数 |
|---|---|
| postcss | 3 |
| js-yaml | 2 |
| brace-expansion | 2 |
| ws | 2 |
| sharp | 1 |
| @babel/core | 1 |

**評価:** 残存11件はいずれも**間接依存のビルドツール由来**。本サービスは**ファイルアップロード機能を持たない**ため、
これらの脆弱性が要求する攻撃ベクトルが成立しないと評価し、**継続監視**とする。
上流パッケージが対応版を出した時点で追随する。

### 2-3. Supabase Security Advisor（DB 設定）

| 深刻度 | 件数 |
|---|---|
| Errors | **0** |
| Warnings | **0** |
| Info | 14 |

Errors / Warnings ともに 0。Info 14件は情報提供レベルのため対応不要と判断。

### 2-4. Malwarebytes（開発端末）

毎日 9:00 のスケジュール実行。直近5日間の結果:

| 日付 | 結果 |
|---|---|
| 2026-07-29 | Detected: None |
| 2026-07-30 | Detected: None |
| 2026-07-31 | Detected: None |
| 2026-08-01 | Detected: None |
| 2026-08-02 | Detected: None |

検出なし。

### 2-5. ESLint（参考記録）

`npm run lint` → **8 errors / 1 warning**。

内訳は `@next/next/no-html-link-for-pages` 3件、react-hooks 系 4件、`@typescript-eslint/prefer-as-const` 1件。
**いずれもセキュリティ脆弱性ではなく**、コーディング規約・パフォーマンス上の指摘。
今回の Next.js 更新の前後で**件数・内容とも完全に同一**であることを、更新前コミットで同じ lint を実行して確認済み（＝更新による新規指摘なし）。
参考情報として記録する。

### 2-6. 認証ログ記録の不具合修正

同日、migration **0039**（commit `645ca8b`）でログイン試行記録（`login_attempts`）の不具合を修正した。

0037 で作成した `login_attempts_id_seq` に `service_role` の `USAGE` 権限が付いておらず、
INSERT が `42501 permission denied for sequence` で全件失敗していた（＝ログイン試行が記録されていなかった）。
0039 で sequence / table への GRANT を付与し、記録を復旧。

RLS（ポリシー0本＝完全deny）の設定自体は正しく、権限（GRANT）層の不備であったことを確認している。

### 2-7. アクセス制御の棚卸し

`src/app/` 配下の**全25ページ**について、認可ガードの適用状況を1枚ずつ確認した。

**結果: 適用漏れなし。** 全25ページでガードが適用されている。
ガードなしで動作するのは `/`（公開ホーム）・`/demo`（env 二重ゲートで本番は 404）の2枚のみで、いずれも意図した公開ページであることを確認した。

詳細は **`docs/access-control-audit.md`** を参照。

**構造的リスク（次回以降の課題）:** ガードが layout ではなく**各ページに個別実装**されているため、
新規ページを追加した際に実装漏れが発生し得る構造になっている。現時点で漏れは無いが、
**layout への集約を次回以降に検討する**。

---

## 3. 2026-09-06 予定分 — 実施記録なし

第1回（§2）で「**2026-09-06（日・第1日曜）に第2回定期診断を実施する**」と予定していたが、
**本ファイルにその回の実施記録は無い。**

**実施したかどうかは未確認**（記録が残っていないため、実施の有無をここで断定しない）。
次の記録は §4 の 2026-09-23 になる。

---

## 4. 2026-09-23 定期診断

- 実施日: 2026-09-23（水）
- 実施者: 原 朋之
- 診断時点のコミット: `44e5932` → 対応後 `f0040ad`
- **記録としては2件目**（第1回＝2026-08-02・§2）。§3 のとおり 2026-09-06 予定分の記録は無い。

### 4-1. CodeQL（静的解析 / SAST）

| 項目 | 件数 |
|---|---|
| Open | **0** |
| Closed | 1 |

未対応の指摘なし。ツールは正常に稼働している。

### 4-2. Dependabot（依存パッケージ / SCA）

| 項目 | 件数 |
|---|---|
| Open | **0** |
| Closed | 41 |

**第1回の残存11件はすべて解消**（postcss 3 / js-yaml 2 / brace-expansion 2 / ws 2 /
sharp 1 / @babel/core 1）。いずれも上流パッケージの対応版に追随して閉じたもので、
§2-2 の「上流が対応版を出した時点で追随する」という方針どおりに収束した。

### 4-3. Supabase Security Advisor（DB 設定）

| 深刻度 | 件数 | 前回（2026-08-02） |
|---|---|---|
| Errors | **0** | 0 |
| Warnings | **0** | 0 |
| Info | **17** | 14 |

**Info 17件はすべて「RLS Enabled No Policy」**。これは**意図した deny-by-default**で、
`50_security.md` §1.2「要らないなら完全 deny を意図として migration に明記する」のとおり。
**対応不要。**

前回の14件から**3件増**。内訳は、
- `organizations` / `organization_members` … migration **0048**（2026-09-23 適用）
- `salon_invites` … migration **0043**（2026-08-25 適用。第1回の診断より後）

いずれもポリシーを意図的に書いていないテーブルで、指摘の増加は**テーブルが増えたことの反映**。

### 4-4. Malwarebytes（開発端末）

| 項目 | 結果 |
|---|---|
| 直近スキャン | **2026-09-23 9:12** |
| 過去6か月の検出 | **0件** |
| リアルタイム保護 | **有効** |

検出なし。

### 4-5. 【追加】public の全テーブルで anon / authenticated に TRUNCATE 等が付いていた

**発見**: `public` の**全17テーブル**で、`anon` と `authenticated` の ACL が `Dxtm`
（D=TRUNCATE / x=REFERENCES / t=TRIGGER / **m=MAINTAIN**）になっていた。

**原因**: テーブルごとの GRANT ではなく、**postgres の既定の権限付与**
（`pg_default_acl`: defaclrole=postgres / defaclnamespace=public / defaclobjtype=r で
anon=Dxtm / authenticated=Dxtm）。`create table` するたびに自動で付いていた。

**なぜ問題か**: **TRUNCATE は RLS を素通りする**。RLS は行に効くが TRUNCATE は
テーブル単位の操作で、ポリシー0件（deny-by-default）でも止まらない。
PostgREST（`/rest/v1`）に TRUNCATE を発行する口は無いため**現状の実害は無いと評価**したが、
「到達経路が思いつかない」は防御ではないため権限そのものを外した。

**対応**: migration **0049**（commit **`f0040ad`**・2026-09-23 18:22 適用）。

| やったこと | |
|---|---|
| 既存17テーブル | `anon` / `authenticated` から TRUNCATE / REFERENCES / TRIGGER / MAINTAIN を REVOKE |
| 既定の権限付与 | `alter default privileges for role postgres in schema public` で同4つを外す（**本体はこちら**。既存だけ直しても次の `create table` で元に戻る） |

MAINTAIN は **PG17 で追加された**権限のため、`server_version_num` を見て動的 SQL で
権限リストを組み立てている（PG16 以前でも構文エラーにならない）。**本番は Postgres 17.6。**

**適用後の確認**:

| 確認 | 結果 |
|---|---|
| public のテーブルの ACL に anon / authenticated | **0件** |
| `pg_default_acl`（public / tables / postgres） | **postgres と service_role のみ** |
| `service_role` の権限 | **17テーブルすべてで有効** |
| anon / authenticated の実効 TRUNCATE | **17テーブル中0** |
| 本番の書き込み（実機） | `/manager/staff` の**プロフィール保存（`staff` の UPDATE）が通る**ことを確認 |

**触っていないもの**（意図的）: `service_role` と `postgres` の権限、`public` 以外のスキーマ
（`storage` / `graphql` / `auth` / `realtime`）、`supabase_admin` の既定の権限付与、
RLS・ポリシー・テーブル定義・データ。

**未確認**: **PUBLIC への grant の有無**は今回の対象外。

### 4-6. 【追加】Google Workspace の管理者アカウントで2段階認証がオフだった

**発見**: `thankstipinn.biz` の **唯一の管理者アカウント**で**2段階認証がオフ**になっていた。

**対応**:
- **2段階認証をオンにした。**
- **バックアップコードを取得し、保管した。**

**未対応（残課題）**: 2つ目の手段が現在**「Google からのメッセージ」のみ**。
**認証システムアプリまたはパスキーの追加は未対応。**
唯一の管理者アカウントであるため、端末を失うと復旧手段がバックアップコードだけになる。

### 4-7. ESLint（参考記録）

`npm run lint` → **12 problems（9 errors / 3 warnings）**。前回（§2-5）は 8 errors / 1 warning。

**いずれもセキュリティ脆弱性ではなく**、コーディング規約・パフォーマンス上の指摘
（`@next/next/no-html-link-for-pages`・react-hooks 系・`no-img-element` など）。
参考情報として記録する。

### 4-8. 持ち越しの確認項目（この回では実施していない）

§2-7・§3 が挙げていた項目のうち、**今回の記録に含まれないもの**:

- **アクセス制御の棚卸しの更新要否**。`docs/access-control-audit.md` は
  **2026-08-02・全25ページ**のまま。2026-09-23 時点で `src/app/**/page.tsx` は **33枚**
  （`/owner` 系3枚を含む）。**棚卸しの再実施は未対応。**
- **認可ガードの layout への集約の検討**（§2-7 の「構造的リスク」）。**未検討。**
  なお `/owner` の実装（§21 コミット3a）でも**各ページに個別実装する既存の作法を踏襲**しており
  （`docs/40_decisions.md` §21）、集約の判断は先送りのまま。

---

## 5. 次回予定

**2026-10-04（日・第1日曜）** に次回の定期診断を実施する。

確認項目:

- CodeQL の open alert
- Dependabot の件数
- Supabase Security Advisor の Errors / Warnings（Info の RLS Enabled No Policy は意図どおり）
- Malwarebytes の直近実行履歴
- **アクセス制御の棚卸し**（`docs/access-control-audit.md` を 25 → 現在のページ数に更新するか）
- **Google Workspace の2段階認証の2つ目の手段**（認証システムアプリ / パスキーの追加）
- **PUBLIC への grant の有無**（0049 の対象外だった分）

---

## 6. 記録方針

- **`npm audit fix --force` は使わない。** breaking change を伴う自動更新は、意図しない挙動変更・
  デグレを招くため実行しない。更新は**パッケージ単位で内容を確認し、意図して行う**。
- **更新後は必ず `npm run build` の成功を確認**してから push する。
- **未解消の指摘は「未解消」として残す。** 件数を良く見せるための取り下げ・除外はしない。
  対応しないものは、**しない理由（攻撃ベクトルが成立しない等）を明記**して継続監視とする。
- **過去の記録は書き換えない。** 訂正が必要な場合は新しい日付のエントリとして追記する。
- 実施のたびに本ファイルへ追記し、対応した変更は commit hash を併記する。
