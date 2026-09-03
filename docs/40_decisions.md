# echo — 決定ログ（Decisions）

> **「なぜそう決めたか」の唯一の正。追記のみ。削除しない。**
> ここに書かれた決定は、忘れたころに必ず効いてくる。特に §1 は全て**実際に事故が起きた**記録である。
> 新しい決定をしたら、日付・理由・実例を付けてここに足す。
>
> 最終更新: 2026-09-03

---

## 1. 事故から学んだ鉄則（DB / migration）

### 1.1 関数を再定義する migration は、必ず本番の `prosrc` を先に読む
`drop function` → `create function` で再定義するときは、本番の現行本文を `select` して確認し、
**過去の migration が追加した処理を全部持ってくる**こと。

> **実例**: 0019 が 0014 の `notification_outbox` enqueue を落とし、7/8〜7/10 の2日間、
> 全サロンで来店リマインド通知が停止した。0021 で再統合。

### 1.2 signature を変える migration は `create or replace` では置き換わらない
PostgreSQL は関数を「名前＋引数型の並び」で識別する。引数の型や数を1つでも変えると、
`create or replace` は**別関数として新規作成**し、古い定義が残って**同名関数が複数並存**する。
PostgREST の `PGRST203`（候補を一意に選べない）で**全呼び出しが失敗**する。

`drop function if exists ...(旧シグネチャ)` を書いても、DROP の引数型が本番の現行関数と
1つでもズレると **DROP は黙って空振り**し、同じ事故になる。

**対策**: signature を変えた後は必ず確認する。

```sql
select p.oid,
       pg_get_function_identity_arguments(p.oid) as args,
       pg_get_function_result(p.oid)             as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = '<関数名>';
-- 2行以上返ったら並存＝事故。古い方を drop function public.<関数名>(<旧引数型>) で除去する。
```

> **実例**: `submit_review_and_earn_stamp` が3バージョン並存し、感想送信が全て 500 になっていた。
> 2026-07-12 発見・修正。

### 1.3 「作成」≠「適用」
ローカルで `supabase/migrations/` に SQL ファイルを作っただけでは**本番 DB に一切反映されない**。
必ず Supabase SQL エディタで手動適用し（列/index を変えたら `notify pgrst, 'reload schema';`）、
REST または `information_schema` で**実在を確認してからコードを push** する。

> **実例**: 0023 を「適用した」つもりがファイル作成だけで、本番に `staff.idempotency_key` が無く
> REST が `column ... does not exist` を返し続けた。2026-07-12。

### 1.4 「適用」≠「記録」
上の裏返し。SQL エディタで本番に適用しただけでは **repo に一切残らない**。
適用したら必ず `supabase/migrations/` に**一字一句同じ SQL** を置く（冒頭に「本番適用済み・再実行しない」ヘッダー）。

> **実例**: 消費型特典の 0025/0027/0028/0029 が repo に無く、0025 は下書きの上書きで本文も消えていた。
> 本番から吸い出して復元。2026-07-16〜17・44e2bb4 で解消。

### 1.5 SQL エディタのタブを作業場にしない
Untitled のまま放置したタブは次の作業で上書きされ、書いた SQL が消える（＝ 1.4 の主因）。

**対策**: ローカルで `.sql` を先に作る → コピペして Run → ファイルはそのまま repo に。
（これで 1.4 も同時に解決する）
エディタで直接書くときは毎回 `+` で新規タブを開き、Run が通ったらその場で名前を付ける。

### 1.6 `public` に `create table` すると RLS が自動で有効化される
イベントトリガー `ensure_rls`（関数 `public.rls_auto_enable`・owner=postgres）が `ddl_command_end` で動く。
**ポリシーを書かなければ完全deny＝REST から一切読めない**。
`supabaseAdmin`（service_role）はバイパスするので書き込み・RPC は通り、**気づきにくい**。
トリガーは `RAISE LOG` のみで画面には何も出ない。

**対策**: 新テーブルを作るときは、同じ migration 内で**ポリシーまで書き切るか、
「完全deny のままにする」を意図的に選ぶ**。
（`0025 reward_redemptions` は後者＝ポリシー0本の完全deny・読む導線は 0030 等の security definer RPC 経由）

> 2026-07-17 の監査で発見。migrations に記録が無かったため 0031 として事後記録。

### 1.7 表示系 bool フラグは DB のデフォルト値を疑う
顧客の表示に関わる bool（`visit_axis_enabled` 等）は、新規サロン登録時に**カラムのデフォルトで決まる**。
表示系フラグを追加・変更するときは、デフォルトが「顧客に見える側」になっているか必ず確認する。

> **実例**: `visit_axis_enabled` が `default false` で作られており、新店の来店カードが全顧客に非表示になっていた。
> 2026-07-11 発見・修正、0022 でデフォルト true 化。

### 1.8 migration 番号 `0007` は欠番（詰め直さない）
採番時に飛ばしただけ。2026-07-17 に本番 DB・repo・git 履歴のいずれにも存在しないことを確認済み。
番号を詰め直すと各所の番号参照が全部ズレて履歴を追えなくなるため、**欠番はそのまま残す**。

### 1.9 SQL エディタで「ちょっと緩めた」制約は、その場で追いつき migration を書く
1.4 の変種で、**より見つかりにくい**。テーブルや関数が丸ごと欠けていれば REST が即エラーを返すが、
制約を緩めただけの差分は**本番が正常に動き続ける**。壊れるのは新環境を作り直したときだけなので、
何ヶ月でも気づかないまま残る。しかも repo に残った古い migration は、単に不足しているのではなく
**現実と違う値を書いた「嘘の記録」**になっていて、読んだ人を積極的に誤らせる。

**対策**:
- 制約を SQL エディタで直接変えたら、**その場で**追いつき migration を書く。「あとで」は来ない。
- 適用済み migration の DDL は書き換えない（履歴が壊れる）。代わりに**その行の直前に
  「これは古い・正は 00NN」というコメントだけ**足して、単体で読んだ人が信じないようにする。

> **実例**: `salons.notify_after_minutes` の CHECK を、通知遅延UIを10分刻みにした際に
> SQL エディタで直接 `10〜360 かつ 10の倍数` へ張り替えたが、0014 は `between 30 and 360` のまま。
> 本番は正常に動き続けていたため発覚せず、2026-08-22 のスキーマ突き合わせでようやく発見。
> 0042 として事後記録し、0014 には注意コメントのみ追加。

### 1.10 「実DBを正とする」なら、制約は**全文**を写す。表示は黙って切れる
Supabase SQL エディタの結果セルは横に切れる。`pg_get_constraintdef` の途中までを見て
「一致している」と判断すると、**存在しない条件の欠けた制約を repo に記録してしまう**。

**対策**: 制約定義はセルを展開して全文を確認する。追いつき migration 側では、期待値との比較を
`regexp_replace(def, '\s+', ' ', 'g')` で**空白を潰してから**行う（括弧・空白の入り方は
PostgreSQL のバージョンで変わるため、生の文字列等価は誤検知する）。

> **実例**: 上の 0042 で、切れた表示から `>= 10 AND <= 360` の2条件と読み、第3項
> `(notify_after_minutes % 10) = 0` を落として記録しかけた。範囲だけ合わせても等価ではなく、
> `between 10 and 360` では 15分・37分が通り、10分刻みUIの前提が DB 側から外れる。
> 適用前に全文を取り直して発見。2026-08-22。

### 1.11 記録が正しいかの唯一の実効テストは「migrations だけで作り直せるか」
本番が動いていることは、migrations が揃っている証拠に**一切ならない**（1.9）。
差分は「新環境を migrations から再構築したときだけ壊れる」形で溜まる。

**対策**: スキーマに関わる作業をしたら、`information_schema.columns` と `pg_indexes` の全件を
migrations の DDL と突き合わせる。アプリコードが触るカラムだけを見る方法では、
**コードが使っていないカラム・インデックス・制約は原理的に検出できない**。

> **実例**: 認証方式B（[[auth-method-line-b]]）の根幹である `staff.line_user_id` /
> `invite_token` / `invite_expires_at` / `bound_at` の4カラムと、部分 unique index
> `uq_staff_line_user_id` / `uq_staff_invite_token` が、本番にはあるのに migration に無かった。
> 特に `uq_staff_line_user_id` は「1 LINE = 最大1 staff」の**唯一の強制点**で、
> `resolveStaffByLineUserId` が1行に解決できる前提そのもの。
> migrations から再構築した環境ではスタッフ招待とスタッフログインが丸ごと動かない状態だった。
> 2026-08-22・0041 として事後記録。

### 1.12 `raise notice` を検証手段に選ばない。Supabase の SQL エディタでは読めない
Supabase の SQL エディタには psql の Messages タブに相当する表示が無く、
`raise notice` / `raise warning` の出力が**どこにも出ない**。しかも `Success` とだけ返るため、
**検証が通ったのか、そもそも検証結果が見えていないだけなのか区別できない**のが最悪の性質。
「警告が出ていないから OK」と読んでしまう。

**対策**: migration に検証を埋めるなら、`do $$ … raise notice … $$` ではなく
**最後に `select` を置いて結果セットとして返す**。エディタは結果セットなら必ず表示する。

```sql
-- ✅ こう書く（結果セットとして必ず見える）
select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='staff'
      and column_name in ('line_user_id','invite_token','invite_expires_at','bound_at')) as staff_cols,
  (select indexdef from pg_indexes
    where schemaname='public' and indexname='uq_staff_line_user_id') as uq_line;
```

`raise exception`（＝失敗させる）だけは有効。エラーは必ず画面に出るので、
「満たされなければ止めたい」条件はこちらで書く。

> **実例**: 0041 / 0042 の検証を全て `raise notice` で書いたため、適用時に何も表示されなかった。
> 同等の内容を `select` で取り直して確認する羽目になった。2026-08-22。
> 適用済みの 0041 / 0042 はそのまま残す（1.9 の原則どおり、適用済み migration の DDL は書き換えない）。

---

## 2. 導出ロジックの多重化に関する決定

### 2.1 cycle 導出の式は 0027 と 0029 で二重化している（統合不可）
感想軸 `floor(earned_stamps.count / 3)` と
来店軸 `floor((実来店 + 移行delta) / visit_cycle_size)` を、
`list_available_consumable_rewards`(0027) と `list_consumable_reward_states`(0029) が**各自に持つ**。

問いが違うため1本に統合できない。
- **0027** =「今この来店で何を消せるか」＝**本日来店ゲート有り**（スキャナ用）
- **0029** =「今 権利として残っているか」＝**ゲート無し**（mypage 用）

**片方だけ直すと mypage とスキャナの表示が食い違う。式を変えるときは必ず両方を同時に直す。**

### 2.2 0030 は cycle 導出を共有しないが、日境界だけは揃える
`get_todays_redemption` / `void_reward_redemption` は「何サイクル貯まったか」を数えないため cycle 導出は不要。
ただし**「本日の来店」の引き方＝ `v_today := (now() at time zone 'Asia/Tokyo')::date` と
`visits.visited_on = v_today` は 0027/0028 と一字一句そろえる**こと。
ズレると done 画面の排他（§3.3）が崩れる。

### 2.3 TS 側で排他を作り直さない
done 画面は**サーバから来た状態だけで分岐する**。
`availableRewards` と `todaysRedemption` の排他は **0027 が保証**している（本日消込済みなら候補0行）。
TS でこれを再実装すると**三重化**になる。

---

## 3. 消費型特典に関する設計判断

### 3.1 消費順は「感想軸 → 来店軸」の固定、各軸内は FIFO

### 3.2 軸はスタッフに選ばせない
軸は現実に対応物が無い**帳簿上の概念**。見えないものを選ばせると押下がランダムになる。
一方、**どの特典を使うかは UI が選ぶ**（顧客との実在の会話なので RPC では絞らない）。

### 3.3 取消は「当日のみ・再スキャンして done 画面から」
- **誰でも可**：`redeemed_by` が端末（kiosk）経路で null ＝ **そもそも操作者を権限で縛れない**ため、
  消込と同じく在籍staff も端末も可とする（`void_reward_redemption` にロール判定を持たせない）
- **当日のみ**：本日の来店に紐づく消込1件だけを対象にする。前日以前は SQL Editor で対応
- **確認ダイアログ無し**：現場で素で押せる。必要と判った時点で足す

### 3.4 「今日は使わない」は記録しない
declined を残すかは将来の判断。別テーブルで後から足せる。

### 3.5 `redeemed_by` は端末（kiosk）経路で null
個人特定不可。`stamp_adjustments.created_by` と同じ割り切り。

---

## 4. UI / フロントの鉄則

### 4.1 送信が必要な input に `disabled` を付けない
ネイティブ form POST では **`disabled` 要素は送信データから脱落する**（HTML 仕様）。
送信中に入力を止めたいなら `readonly` ＋ `pointer-events`、
または **fetch 送信にして body を state から明示構築**する（DOM シリアライズに依存しない）。

> **実例**: `AddStaffForm` で送信中に name input を disabled にし、name 欠落で 400・
> 「作成中…」のまま復帰不能。2026-07-12・fetch 化で解消。

### 4.2 `position: fixed` のモーダルは `createPortal(..., document.body)` で出す
祖先要素に `transform`（`translateY(0)` でも該当）があると、`position: fixed` の基準が
ビューポートでなくその祖先になり、中央配置のモーダルが画面外へ飛ぶ。

> **実例**: `.animate-in` の `transform` に閉じ込められ、削除モーダルがオーバーレイだけ見えて中身が画面外。
> 2026-07-12・portal 化で解消。

### 4.3 タッチ端末の `:hover` は「タップ後に貼り付く」
iPadOS には本物の hover が無く、タップした要素の `:hover` 状態が残る。
**同じ位置に別のボタンが出現すると、その新ボタンが直前の hover 塗りを引き継いで固定される。**

**対策**: hover 規則は必ず `@media (hover: hover)` で囲む。

> **実例**: `/staff/visit` の done 画面で、「来店を記録」の hover が同位置に現れる「◯を使う」ボタンに
> 貼り付いて黒塗り固定＝**慎重に押すべき消込ボタンが最も押しやすそうに見える視覚重み逆転**。
> 2026-07-17・全 `.btn` の hover を `@media (hover: hover)` で囲って解消・5f3d7ba。

### 4.4 取り返しのつかない操作は「構造的なガード」で守る
hard delete 等は「原因を1つ直す」のではなく、**確認を経た状態でしか実行に到達できない**設計にする。
実行関数の入口で、モーダルの open 状態と実行条件を検査し、満たさなければ即 `return`。
状態の完全初期化・毎回新しいモーダルDOM（`key`）等と合わせた**多層防御**にする。

> **実例**: スタッフ連続削除の2回目で確認がスキップされた件を、
> `handleDelete` 入口ガード＋全リセット＋portal key で不能化。2026-07-12。

### 4.5 「ランク」（件数由来の A/B/C/D）は意図的に無効。「ティア」とは別物

**この2つは繰り返し取り違えられる。名前が似ているだけで、出自も可否も違う。**

| | ランク | ティア |
|---|---|---|
| 実体 | echo が**通算件数から自動導出**する A/B/C/D | **お客様が選んだ**評価スタンプの種類 |
| 正 | `@/lib/staff-stats` の `rankForCount()` | `@/lib/rating-tiers` の `RATING_TIERS`（👍☕🍰💐👑） |
| 表示 | **どの画面でも出さない**（`RANK_ENABLED = false`） | `/staff/received/[reviewId]` で**無条件に表示**（hero 絵文字＋tier名） |
| スイッチ | `RANK_ENABLED`（恒久 false） | **無し**。フラグで包んでいない |

**ランクを恒久的に false にする理由**（2026-08-22 に再確認・据え置き）:

- **通算基準の累積指標**であり、「届いた瞬間の体験」ではない。個別レビュー詳細のランクも
  `rankForCount(totalCount)` ＝ 通算で、その1件とは関係がない。
- 累積の序列はスタッフ間の**比較・ランキング化**を招く。echo は ES 向上のためのアプリで、
  スタッフを順位付けする道具ではない（`docs/00_philosophy.md`）。
- 閾値（100/50/20）が**仮置き**のため、若手が構造的に D 固定になる。「育成の目安」にすらならない。

一方**ティアは見せる**。お客様が能動的に選んだ贈り物であり、届いた瞬間の体験そのものだから。
ただし **¥金額は出さない**（原則6・賞与非連動）。スタッフ画面は `rating_purchases.amount` を
**select すらしない**構造で担保している（`/staff/received/[reviewId]` は `.select("tier")` のみ、
`/staff` は `count: exact, head: true` で行を引かない）。この構造を壊さないこと。

**ティア別の集計・内訳を `/staff` に足さない。** 累積のティア別内訳は、ランクと同じく比較を招く。
ティア別集計が存在してよいのは `/dashboard`（`eval-data.ts` / `dashboard-data.ts`）だけ。

> **実例**: 「`RANK_ENABLED = false` でティア表示が全面 OFF になっている」という前提で
> フラグを場面別に分割する改修が提案された。実際にはティアは最初から表示されており、
> `RANK_ENABLED` を触っても**ティアの表示は1ピクセルも変わらない**。
> 2026-08-22・調査の結果コード変更は不要と判断し、取り違え防止のコメントとこの項目のみ追加。

---

## 5. PWA / iOS に関する知見

### 5.1 ホーム画面アプリ名は「どの追加経路か」で決まるソースが変わる
- **新経路（iOS 17.4+・有効な manifest がある）**: アプリ名も着地も **manifest の `name` / `start_url`** が優先
- **旧経路（manifest が読めない・standalone 無効）**: `apple-mobile-web-app-title` → 無ければ `<title>`
- **Android/Chrome**: 経路によらず常に manifest の `name`

**対策**: どちらの経路に落ちても同じ名前になるよう、
**`manifest.name` と `appleWebApp.title` を同一文字列にそろえる**。

> ⚠️ 2026-07-16 に「iOS は常に apple-mobile-web-app-title から取る」と記録したが、
> これは**旧経路のみ成立**で、新経路では manifest.name が勝つ。当時の断定は誤り。2026-07-17 に実機で訂正。

### 5.2 iOS はアプリ名/アイコンを追加時に確定・キャッシュする
名前やアイコンを変えても既存のホーム画面アイコンには反映されない。
反映には**一度削除→再追加**が必要（実機検証時の必須手順）。

### 5.3 standalone PWA は Safari と別 cookie ジャー
`/kiosk` は**アイコン起動のたびに `start_url=/kiosk/setup` を通り cookie を張り直す**設計。
これで ①standalone 別ジャー隔離 ②iOS ITP 失効 ③cookie 1年超え、を都度救う。

`scope` は**末尾スラッシュ無し必須**（within はパス前方一致のため）。

### 5.4 【設計判断・承知の上】per-salon manifest の start_url に device_token が載る
据え置き受付端末を standalone で自己プロビジョニングさせるための対価。
**httpOnly cookie ほどは隠れない**ことを承知の上で採用する。

- web clip 自体は iCloud 同期しない。漏れ口は **Safari 履歴/ブックマークの iCloud 同期**に限られる
- 据え置き端末は**専用 Apple ID・Safari 同期OFF が推奨**
- 店長 Apple ID（同期ON）なら伝播先は本人の端末＝実害は小さいが、**共用 Apple ID は不可**
- token は**サロン単位の bearer**。被害範囲は当該サロンの来店記録に限定（他店越境不可・PII 非開放）
- 紛失時は `/manager/kiosk` で再発行＝全コピー即時失効

### 5.5 device_token は `salons` に1つ＝iPad 3台で共有
1台紛失で再発行すると全端末が失効し全台再スキャンが必要。
3台規模では許容。端末別失効が要れば `device_tokens` テーブルへ分割する。

---

## 6. 運用ルール

### 6.1 migration は SQL エディタで手動適用。`supabase db push` は使わない
### 6.2 DB 書き込みは全て `@/lib/supabase-admin` の共有 `supabaseAdmin`。独自に `createClient` しない
### 6.3 SQL は Claude Code に書かせず、チャットで書いて SQL エディタで実行する
### 6.4 一度に一つの変更を実機で確認してから次へ進む

---

## 7. Stripe / 決済に関する判断

### 7.1 複数サロンでの Stripe アカウント共有は**保留**（2026-08-22 調査・未着手）

**要望**: cartaLLC の suco と nun は同一法人・同一口座で、Stripe アカウントを分ける必要がない。
`salons.stripe_account_id` の UNIQUE（`salons_stripe_account_id_key`）を外して共有したい。
他社の多店舗オーナーからも同じ要望が出ると想定される。

**結論: 9月パイロット前にはやらない。** 理由:

1. **パイロットは UNIQUE を外さなくても回る。** Stripe アカウントを2つ作れば今日のコードで動く
   （同一法人・同一口座でも Standard アカウントは複数持てる）。パイロットの目的は
   「評価が届く体験」の検証であって多店舗課金の検証ではない。
2. **本当のコストは UNIQUE ではなく導線の新規実装**（下表 #2）。制約を外すだけでは何も共有できない。
3. **決済経路の変更は最も戻しにくい。** パイロット中に踏むと、原因の切り分けが
   「echo の体験の問題」と混ざって検証そのものが濁る。

**パイロット前にやること**: cartaLLC と「suco / nun は当面 Stripe アカウント2つで運用する」を合意する。
**着手の判断材料**: 多店舗オーナーからの要望が実際に2件目・3件目と出た時点。
**着手時の順序**: #2 → #3 → #1 → #5。
organizations 導入後（§8）は「同一 `organization_id` のサロンから `stripe_account_id` を継承」と書ける。

#### 調査結果（2026-08-22 時点。着手時はまず現状と一致するか確認すること）

`stripe_account_id` を**絞り込みキー**に使っているのは webhook の2箇所だけ。
他は全て `.eq("id", …)`＝PK 引きで値を読むだけなので UNIQUE の有無に影響されない。
`salons` に対する `.single()`/`.maybeSingle()` は14箇所あるが、**全て PK 引き**で無関係。

| # | 箇所 | 共有時に何が起きるか | 改修案 |
|---|---|---|---|
| 1 | `webhook/connect` `resolveSalonIdByAccount` | `.maybeSingle()` が2行以上でエラー → 握り潰して null → **`stripe_events.salon_id` が常に NULL**。監査が劣化する。決済記録自体は `session.metadata.salon_id` 由来なので無事 | `checkout.session.completed` は metadata から取る。`account.*` は一意に決まらないので `stripe_events` に `account_id` 列を足し salon_id は NULL 許容のまま |
| 2 | `api/manager/stripe/onboard` | **本丸。** 2つ目のサロンは `stripe_account_id` が null なので「接続」を押すと**新しいアカウントを作ってしまう**。既存アカウントを共有する導線が存在しない | 同一オーナーの既存アカウントを選ぶ UI。オーナーの他サロンから `stripe_account_id` を継承する形が最小 |
| 3 | `api/manager/stripe/return` | 同期経路が2つあり**キーが違う**。webhook は `stripe_account_id`（＝共有する全サロンを更新・正しい）、return は `ctx.salon_id`（＝操作した本人だけ）。兄弟サロンのフラグが stale になり、その間 checkout が **409 `salon_not_onboarded`** で落ちる | 両経路を「`stripe_account_id` で全行更新」の1関数に統一する |
| 4 | UNIQUE 撤去そのもの | 「同じアカウントを二重接続した事故」を検出する唯一のガードが消える。`onboard` の競合ガード `.is("stripe_account_id", null)` は自分の行しか見ていない | 意図的な共有と誤接続は DB では区別できない。同一 account を持つ salon 数を監視するビュー／アラートで代替 |
| 5 | **インデックス** | `salons_stripe_account_id_key` を drop すると**裏のインデックスも消える**。webhook の2クエリが seq scan になる | drop と同時に `create index … on salons(stripe_account_id) where stripe_account_id is not null` を張る。**必ず同一トランザクション**で |
| 6 | Stripe 側（コード外） | 領収書・明細の事業者名は connected account 単位で1つ。suco / nun で分けられない | line_item 名には `salon.name` が入る（`api/checkout`）ので明細行では区別可。事業者名の扱いは §9 の税理士確認事項 |
| 7 | テナント分離 | **影響なし。** 集計・可視性は全て `salon_id` スコープで、アカウント共有でデータが混ざる経路は無い | — |

> ⚠️ `syncAccountFromStripe` が複数行更新に耐えるのは偶然ではなく、`.select("id")` の
> **配列長**で成否を判定しているため（`.single()` にすると壊れる）。ここを「1件のはずだから」と
> `.single()` に書き換えないこと。

---

## 8. 会社（organization）概念の導入

### 8.1 organizations 設計（2026-09-03 決定）

#### テーブル

- `organizations`（会社）
- `salons.organization_id`
- `organization_members`（誰がどの会社のオーナーか）

#### 組織の実態（導入時点）

- carta LLC: CARTA / Niii / nun Fukushima / suco / SELNI
  SELNI は当面（4年程度の想定）carta と同一組織として扱う
- L/MA: 別組織
- 第三者サロン: 契約ごとに1組織

#### 請求

会社単位。店舗ごとにスタッフ数で料金を算出し、合算する。

§7.1 の Stripe アカウント共有は、organizations 導入により「同一 `organization_id` のサロンから継承」として実装できる。

#### 可視範囲

- オーナー: 自社の全店舗のみ。他社は一切見えない
- echo Labs: 全契約サロン（現行の `/admin/*` を維持）

#### 画面設計

`/owner` を新設する。

できること:
- 読み取り: 自社全店舗の稼働状況
- 書き込み: スタッフの店舗移動、権限変更（この2つのみ）

できないこと（各店長が `/manager` で行う。現行のまま）:
- 店舗の設定、スタッフ招待、特典設定、店頭QRの表示

理由: carta の実運用では、店舗の設定とスタッフ招待は各店長が
自分で行っている。オーナーが全店舗の `/manager` に入る必要はない。
また `getStaffContext()` が単一 `salon_id` を持つ前提を崩すと、
`/manager` 配下の10箇所以上のスコープ指定すべてに影響し、
認可の事故リスクが高い。`/owner` を別に作れば既存には触れない。

書き込みを2つだけ持たせるのは、店長が退職・異動で不在になったとき、
オーナーが自分で店長を任命できる必要があるため。

#### 招待フローの変更

現行は「1コード = 1サロン」で、組織の概念がない。
複数店舗を持つ会社と契約したとき、どのサロンが同じ会社かを
システムが判別できない。

変更後:
1. echo Labs が `/admin/organizations` で会社を作る（会社名・オーナーを登録）
2. その会社に対して `/admin/invites` から招待コードを必要本数発行する
3. オーナーがコードを使ってサロンを作ると、自動的にその会社に紐づく

`salon_invites` に `organization_id` を追加し、発行フォームに
会社の選択を追加する。既存フローの変更はこれだけ。

選び間違いを防ぐため、発行画面には会社名と既存サロン数を表示する。

採用理由: 契約は会社と結ぶものであり、「A社と契約して3店舗ぶん」という
順序が実態。サロンを先に作って後から会社を割り当てるのは順序が逆で、
請求先が決まらない期間が生まれる。またコードが最初から会社に紐づいていれば、
「このサロンはどの会社か」を人が判断する場面がゼロになり、
取り違えが構造的に起こらない。

#### サロンの組織移動は機能として作らない

作った後にサロンを別の会社へ移す画面は用意しない。
日常の誤操作で組織が混ざるのを防ぐため。

発生しうるケース（例: SELNI が独立して別会社になる）は、
サロンを削除して作り直すのではなく、`organization_id` を
SQL で書き換えることで対応する。

理由: 削除・再作成では顧客の来店履歴・スタンプ・特典、
スタッフの `line_user_id` 紐付けがすべて失われる。
契約上は「carta との契約から1店舗減、新会社と新規契約」でも、
システム上は `organization_id` の付け替えのみで足りる。
契約書の話とデータの話は分けて扱う。

#### 未決定（実装前に決める）

1. オーナーの認証方法
   `organization_members` に LINE user ID を持たせ、`admin-guard` と
   同じ型で判定するのが素直。ただし echo Labs 運営者は env、
   オーナーは DB という二重管理になる点をどう扱うか

2. オーナーの登録方法
   `/admin/organizations` から echo Labs が登録する想定だが、
   画面の詳細は未設計

3. 既存データの移行
   `salons` 7行への `organization_id` 割り当て。
   テストサロン・デモサロンの扱い（echo Labs 自身の組織にするか、
   NULL 許容にするか）

#### 時期

2026年10月末までに実装したい。第三者サロンとの契約が
その頃から動きうるため。
