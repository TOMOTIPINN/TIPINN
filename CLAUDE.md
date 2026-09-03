# echo — プロジェクトガイド

> このファイルはリポジトリ直下に置く。Claude Code は起動時に自動で読む。
> **ここは「変わらない前提」だけを置く薄い入口。** 詳細は `docs/` に移設済み（下記）。
> 最終更新: 2026-09-03

---

## 作業前に必ず読む

| ファイル | 中身 |
|---|---|
| `docs/00_philosophy.md` | なぜ作るか・やらないこと（最上位） |
| `docs/10_domain.md` | 用語とデータモデル |
| `docs/20_product.md` | 画面とAPI |
| `docs/30_design.md` | デザインシステム |
| `docs/40_decisions.md` | 決定ログ・事故から学んだ鉄則 |
| `docs/50_security.md` | セキュリティ不変条件 |
| `docs/60_incidents.md` | 障害・不具合の記録（時系列・残課題） |

**矛盾したら `00` > `40` > `10`/`20`/`30`/`50` > `60` > `CLAUDE.md` の順で優先する。**

`60` が設計文書より下・`CLAUDE.md` より上なのは、**60 は起きた事実の記録であり設計判断ではない**ため。
設計文書と矛盾する場合は設計文書が正。ただし**実際に観測された事実は作業指示より重い**ので `CLAUDE.md` より上に置く。

`docs/archive/` は**参照はするが正ではない**（→ `docs/archive/README.md`）。
`docs/ui-v2.2.pdf` は**視覚の参考であって仕様の正ではない**（価格表が旧版のまま等の既知のズレがある）。

### 旧セクション番号の対応（コード・migration のコメント参照用）

既存のコメントに残る `CLAUDE.md §N` は、下記に読み替える。

| 旧 | 内容 | 現在の正 |
|---|---|---|
| §4 | データモデル | `docs/10_domain.md` |
| §5 | デザインシステム | `docs/30_design.md` |
| §7 | 画面マップ | `docs/20_product.md` |
| §8 | ビルド規約 | `docs/30_design.md` §7 ／ `docs/50_security.md` §1.4 |
| §11 | 現在の進捗 | `docs/archive/CHANGELOG.md`（履歴・正ではない） |
| §12 | デザインシステム（UI/ダッシュボード） | `docs/30_design.md` |
| 変更時セキュリティ・チェック | — | `docs/50_security.md` |

§1 / §2 / §3 / §6 / §9 / §10 は**番号を変えずに残している**（既存参照が指し続けるため）。
§3 の migration・関数・RLS・UI・PWA の鉄則群は `docs/40_decisions.md` に移設した。

---

## 1. echo とは

美容サロン向け「感謝 × 評価」アプリ。お客様が担当スタッフへ
①感想（無償レビュー）②有償の「評価スタンプ」を送れる。

- ブランド: **Your work echoes.**
- 旧名 tipinn。リポジトリ名・package名は `tipinn` のまま、製品名は **echo**。

→ 思想・やらないことは `docs/00_philosophy.md`

---

## 2. 絶対原則（崩すと規制・税務が壊れる。最優先で死守）

1. echo は資金を預からない（Stripe Connect **Direct Charge**）
2. application fee = **0**
3. 有償スタンプ（評価）と無償スタンプ（貯まる）は**別テーブル**
4. 評価スタンプは買い切り・残高なし＝**即時送信型**
5. スタッフは「評価対象」であり金銭受取人ではない（お金はサロン名義で受領 → 賞与等で反映）
6. 賞与は購入代金と機械的に連動させない
7. 個人情報は echo 一元管理（サロンは自店データのみ）
8. 価格は echo 側で固定。サロンは金額もパターン数もいじれない

---

## 3. 技術スタック / 規約

### スタック
Next.js 16（App Router, Turbopack）/ Supabase（東京, project id: `ztvjwfofznqndqbsnluq`, 名称「エコー」）
/ Vercel / Stripe Connect Direct Charge / LINEログイン

### リポジトリ
- `github.com/TOMOTIPINN/TIPINN`（main 直コミット）
- ローカル: `~/dev/TIPINN`（Mac / zsh）

### env（Supabase は新キー命名）
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`（旧 anon key 相当）
- `SUPABASE_SECRET_KEY`（旧 service_role key 相当）

**秘密値に `NEXT_PUBLIC_` を付けない**（→ `docs/50_security.md` §1.3）。
env の全一覧は `docs/20_product.md` §8。

### DB アクセス
- **DB 書き込みは全て** `@/lib/supabase-admin` の共有 `supabaseAdmin`（service_role）を**サーバー側で**使う。
  **独自に `createClient` しない。**
- 全テーブルが RLS 有効・ポリシー0件＝deny-by-default。テナント分離は `salon_id` スコープで担保する
  （→ `docs/50_security.md` §1.1）

### migration
- SQL は `supabase/migrations/` に置きつつ、**適用は常に Supabase SQL エディタで手動。`supabase db push` は使わない。**
- **「作成」≠「適用」≠「記録」**。適用前後の確認手順と過去の事故例は `docs/40_decisions.md` §1 を必ず読むこと。

### セッション
`@/lib/session` の `getSession()` → `{ customer_id, line_user_id } | null`。Cookie 名 `echo_session`。

---

## 6. 評価スタンプ価格（★確定・税込 / 2026-06-16・Wonderful改定 2026-06-18★）

| ラベル | 価格 |
|---|---|
| Thank you | ¥100 |
| Grateful | ¥500 |
| Wonderful | ¥1,000 |
| Amazing | ¥3,000 |
| Unforgettable | ¥10,000 |

- 全て税込（消費税 = amount × 10/110）。消費者向けは税込表示。
- `rating_purchases` に CHECK 制約で固定済み（amount 限定 ＋ tier×amount のペア固定）。
- app 側の正は `@/lib/rating-tiers`。
- ⚠️ **UI v2.2 PDF(06-09) は旧価格（¥300 / 500 / 1,000）を表示している。こちらの表が新・正。PDF は要更新。**

---

## 9. 専門家確認の要点（記録）

- **金融庁フィンテックサポート**: 資金移動業不要・前払式非該当の見解取得済
- **税理士**: 評価スタンプ売上は課税売上10%・税込表示 / 即時送信型なら購入時課税（規約に「即時送信型」明記）/
  領収書発行義務はサロン側、echo がサロン名義で発行サポート（オン/オフ可）/ 賞与反映は給与所得・源泉徴収
- **社労士**: 賞与から開始が無難
- **弁護士**: 利用規約の最終確認（未）

---

## 10. 法人化

「外部サロンに出す瞬間」に法人設立・Stripe本番・LINE公式・規約の事業者名を集約する方針だった。

運営社名: **echo Labs株式会社**（2026-07-17 設立・2026-08-03 登記完了）。
