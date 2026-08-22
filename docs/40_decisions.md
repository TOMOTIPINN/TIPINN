# echo — 決定ログ（Decisions）

> **「なぜそう決めたか」の唯一の正。追記のみ。削除しない。**
> ここに書かれた決定は、忘れたころに必ず効いてくる。特に §1 は全て**実際に事故が起きた**記録である。
> 新しい決定をしたら、日付・理由・実例を付けてここに足す。
>
> 最終更新: 2026-08-22

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
