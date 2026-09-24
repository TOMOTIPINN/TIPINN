# 法務の決定と依頼状況

顧問弁護士（山口先生）への相談内容・回答・依頼中のものを記録する。

このファイルは「法務として何が決まったか／何がまだ決まっていないか」の台帳。
**各行に出典（日付）と状態を必ず付ける。**

状態の語は4つだけ:

| 状態 | 意味 |
|---|---|
| **回答済み** | 先生から回答を得ており、実装・運用の根拠にしてよい |
| **依頼中** | 送付済みで回答待ち。**この状態のものを根拠に確定させない** |
| **未依頼** | まだ相談していない |
| **未確認** | 依頼したか／回答があったかが、こちらで把握できていない |

設計判断は `40_decisions.md`、起きた事実は `60_incidents.md` に書く。
ここから参照するのは構わないが、**法務の回答そのものはここを正とする**。

> 最終更新: 2026-09-24

---

## 1. 回答済み

| 項目 | 回答 | 日付 |
|---|---|---|
| **特定商取引法の販売業者** | **各サロン**（echo Labs ではない） | 未確認（日付不明） |
| **スタッフ写真・氏名の公開** | **本人のチェックボックス同意で足りる** | 2026-09-13 |
| 同上（代理申告） | **店長による代理申告は不可**（本人に代わって許諾する権限がない） | 2026-09-15 |
| **同意前に顧客画面に表示される期間** | **承諾がなければ消せる体制**＋**確認までの時間が短い**ことを条件に可 | 2026-09-15 |
| **未成年への販売** | **有料スタンプは販売しない。** 年齢確認は「18歳以上」のチェックで足りる | 2026-09-13 |
| **監査ログの保存期間** | **3〜5年** | 2026-09-13 |

**特商法の販売業者**は回答済みだが、**回答日が未確認**（記録が残っていない）。

### 実装への反映

| 回答 | 反映先 |
|---|---|
| 本人のチェックボックス同意 | `40_decisions.md` §10.1（`6205fa9`） |
| 代理申告は不可 | §10.1（店長申告方式 `d228224` を撤回） |
| 表示期間の条件 | §10.1 決定7（アーカイブ＋「未参加・N日経過」表示 `a525f35`） |
| 未成年・年齢確認 | §11（`8af3c98`） |
| 監査ログ 3〜5年 | 下記「2. 当社判断」で**3年**に決定 |

---

## 2. 当社判断（先生の回答を受けて当社が決めたもの）

### 監査ログの保存期間 → **3年**

先生回答は 3〜5年（2026-09-13）。**範囲の下限を採る**と当社で判断した。

### プライバシーポリシーの保存期間

いずれも**当社判断**。先生の回答に基づく数値ではない（監査ログを除く）。

| データ | 保存期間 |
|---|---|
| アカウント情報 | 最終利用から **2年** |
| 購入履歴 | **7年** |
| 来店履歴 | **3年** |
| 特典・スタンプ調整 | **3年** |
| 通知履歴 | **6か月** |
| 監査ログ | **3年**（先生回答 3〜5年の下限） |
| IPアドレス | **30日** |

**実装状況は下記「5. 実装宿題」を参照。** 現時点で削除処理があるのは IP（`login_attempts`）のみ。

---

## 3. 依頼中（回答待ち）

| 項目 | 内容 | 日付 |
|---|---|---|
| **プライバシーポリシー最終チェック** | 当社で回答を反映した確定案を送付し、最終チェックを依頼 | 2026-09-15 |
| **告知文の法的十分性** | 購入画面の「お名前とスタンプの種類が、担当スタッフとサロンに表示されます。」で足りるか。ポリシー**第5条4項**とあわせて依頼 | 2026-09-15 |

### プライバシーポリシーの経緯

| 日付 | 内容 |
|---|---|
| 2026-08-29 | **作成を 5万円で発注** |
| 2026-09-15 | 当社で回答を反映した**確定案を送付**し、最終チェックを依頼 |

問い合わせ窓口: **info@echo-thanks.jp**

### 未報告・未確定（送付文に含めていないもの）

**この2点は 2026-09-15 の送付文に書いていない。** 先生と認識が揃っていない。

1. 2026-09-13 に「ここまでの請求」と伝えたあとに出した**訂正**の扱い
2. **最終チェックが 5万円の範囲に含まれるか**

---

## 4. 未依頼・未確認・範囲外

### 未依頼

2026-08-29 に**依頼を絞った**ため、まだ相談していないもの。

| 項目 | 備考 |
|---|---|
| **サロン向け規約** | `40_decisions.md` §10.1 未確認2 と同件 |
| **購入者向け利用条件** | |
| **carta ↔ echo Labs の業務委託契約** | |
| **PayPay 導入（10月以降）の前提条件** | 導入時期が来る前に相談が要る |

### 未確認

| 項目 | 内容 |
|---|---|
| **サロンをまたいだ閲覧（同一運営会社の複数店舗）** | **ポリシー回答後に自己確認。** → 下記「4.1」 |
| 2026-07-22 の相談分 | **回答があったかどうかが未確認** |
| 2026-07-30 の相談分 | **回答があったかどうかが未確認** |
| 特商法の販売業者の回答日 | 回答内容は確定しているが、**いつ得たかが未確認** |

### 範囲外

| 項目 | 状況 |
|---|---|
| **労働基準法（賞与の賃金性）** | **山口先生には確認できていない。** 専門領域が異なる（`CLAUDE.md` §9 では社労士に「賞与から開始が無難」との確認あり） |
| **店長の閲覧記録（誰がいつどの感想を読んだか）** | **依頼しない。** `40_decisions.md` §21 決定4 で**機能自体を作らない**と決めたため、法務論点が発生しない。従業員の行動記録は労務領域で、上記のとおり山口先生の専門外でもある |

---

### 4.1 サロンをまたいだ閲覧（同一運営会社の複数店舗・`/owner`）

**状態: 未確認（ポリシー回答後に自己確認）。** 設計は `40_decisions.md` §21（2026-09-19 決定・実装は未着手）。

#### 何が問題か

`/owner` は**同一運営会社のオーナーが、自社の複数店舗の感想（顧客名を含む）を横断して見る**画面。
carta LLC なら CARTA / Niii / nun Fukushima / suco / SELNI の5店舗が対象になる。

ここに緊張がある:

- **特商法の販売業者は「各サロン」**（上記「1. 回答済み」）。
  **同一組織でも、店舗X と 店舗Y は法律上は別の販売業者**になる。
- 当社の設計原則は「**個人情報は echo 一元管理。サロンは自店データのみ**」（`CLAUDE.md` §2-7）。
  「サロン」が**法人単位なのか店舗単位なのか**を、この原則は決めていない。

#### やること

1. **2026-09-15 送付のプライバシーポリシー最終チェックの回答が返った時点で、確定版に
   「運営会社が複数店舗を運営する場合、その運営会社が閲覧する」と読める記述があるかを確認する。**
2. **無ければ、その1文を足す。**（先生への再依頼が要るかは、1文の追加で済むかどうかを見て判断）
3. **`/owner` の設計・実装は法務待ちにしない**（`40_decisions.md` §21「法務」）。
   確認の結果が「1文を足す」で収まる見込みのため。

#### 先送りにしたもの

**SELNI が将来独立して別会社になる場合**、`organization_id` の付け替えでデータは動く
（`40_decisions.md` §8.1）が、**独立前の期間にオーナーが SELNI の顧客データを見ていたことの扱い**は
別途決める必要がある。**今は4年契約のため先送り**（`40_decisions.md` §8.1「SELNI は当面（4年程度の想定）」）。

フランチャイズ（事業者が別会社）一般の扱いも、この論点と同じ形。**現時点で依頼していない。**
「サロン向け規約」（上記「4. 未依頼」）と同じ便で出せる内容。

---

## 5. 実装宿題（ポリシーと実装の差）

**プライバシーポリシーに書く内容に対して、実装が追いついていないもの。**
ポリシー確定前に「書くか／実装するか／運用で受けるか」を決める必要がある。

| # | 項目 | 実装 | 当面の扱い |
|---|---|---|---|
| 1 | **退会・削除機能** | **画面・API は作らない**（2026-09-24 決定） | **窓口（info@echo-thanks.jp）への申出を手作業で処理**する。**手順書は §7**。窓口は `/mypage` の末尾に表示（`b44fde8`） |
| 2 | **保存期間の削除処理** | `login_attempts`（IP）**以外はすべて無期限** | 最初に期限が来るのは**通知履歴6か月**（`notification_outbox`）。それまでに削除処理を用意するか、期間の記載を見直す |
| 3 | **`stamp_adjustments.note` が自由記述**（★訂正・下記★） | 本番の audit_log の `new_data.note` は**448件すべて null**（2026-09-24） | **個人情報を書かない運用ルールが必要。** 書かれると監査ログ（3年保存・削除処理なし）に個人情報が混入する |

**★#3 の訂正（2026-09-24）★** 以前は「`audit_log.note` が自由記述・列は存在」と書いていたが、
**`audit_log` に `note` 列は存在しない**（本番の列は `id, salon_id, customer_id, actor_type, actor_id,
action, table_name, record_id, old_data, new_data, created_at`）。
自由記述なのは **`stamp_adjustments.note`** で、トリガー `fn_audit_log` がその行を丸ごと
**`audit_log.new_data.note`（UPDATE・DELETE 時は `old_data.note` にも）に写す**。
懸念の中身（書かれたら監査ログに3年残る）は変わらない。

### 補足（2026-09-15 の調査で確認した事実）

- `audit_log` の対象は **4テーブルのみ**（`stamp_adjustments` / `earned_stamps` / `rewards` / `reward_redemptions`）。
  `customers` / `reviews` / `rating_purchases` は監査対象**外**。
  ただし**トリガー定義（prosrc）は未確認**（この環境から `pg_catalog` を読めない）。
- `audit_log` に**氏名・感想本文・LINE ユーザーIDは入っていない**（現データの全キーを確認）。
  ただし `customer_id`（UUID）は入る＝`customers` と突合すれば個人に到達する**仮名化情報**。
  → **2026-09-24 に再確認**（674件すべて。`customers.display_name`・`customers.line_user_id`・
  `staff.name`・LINE ID の形式と照合し、`new_data`・`old_data`・`actor_id` のどこにも一致なし）。
  スタッフは `created_by` / `redeemed_by` 等の UUID でのみ入る。
- **年齢確認は echo の DB に保存していない。** Stripe Checkout Session の metadata
  （`adult_confirmed` / `adult_confirmed_at`）にのみ記録（§11）。
- クライアント（anon キー）からは**全テーブルが GRANT レベルで拒否**される（42501）。
  ただし **RLS の有効状態・ポリシー数は未確認**。

---

## 6. 保留（スタッフの回答待ち・法務案件ではない）

### nun Fukushima の staff 行「nun」

| 項目 | 内容 |
|---|---|
| 状況 | `role=manager` の staff 行「nun」が**店舗共用端末の店長アカウント**として使われている。**実在の人物ではない**が、`archived_at` が null のため**顧客のスタッフ選択画面に表示される** |
| 実害 | **2026-07-15 のテスト感想1件のみ**。顧客からの申告なし |
| 確認中 | **共用端末で店長画面（`/manager/inbox`・`/dashboard` 等）を使っているか**をスタッフに確認中 |
| 受付のみだった場合 | **`/kiosk` 登録に切り替え、「nun」行をアーカイブする**（コード変更なし） |
| 注意 | `archived_at` を立てると**同じ行での店長ログインも失効する**（`staff-session.ts` が `archived_at is null` を要求）。切り替えの順序を誤ると店長画面に入れなくなる |
| 他サロンの同構造 | **未確認。** 「実在の人物でない」を示す列が存在しないため、SQL では候補抽出までしかできない |

詳細は `60_incidents.md` を参照。

---

## 7. 手作業での退会の手順書（プライバシーポリシー第7条）

**2026-09-24 決定**: 第7条の退会は、当面「**窓口（info@echo-thanks.jp）への申出を受けて、
当社が手作業で処理する**」方式で約束を守る。**退会の画面・API は作らない。**
案内は `/mypage` の末尾に小さな1行で置く（目立たせないが見つけられる場所・`b44fde8`）。

**この手順は本番 DB への手作業の書き込み**なので、Supabase SQL エディタで行う
（`CLAUDE.md` §3・migration と同じ場所）。**1件ずつ・1人ずつ**処理する。

### 7.1 方針：行は物理削除せず、識別子を置き換える

`customers` の行を **delete しない**。理由（migration の FK 定義による。
**本番の定義は `pg_catalog` を読めないため未照合**）:

| `customers` を参照する表 | `on delete` | 物理削除すると |
|---|---|---|
| `rating_purchases`（0001） | **RESTRICT** | 購入が1件でもあると**削除そのものが失敗する** |
| `reward_redemptions`（0025）・`earned_stamps`（0001）・`stamp_adjustments`（0019） | CASCADE | **特典・スタンプの履歴が消える**＝第7条の「特典の利用履歴を保有し続ける」に反する |
| `visits`（0009）・`notification_outbox`（0014）・`reviews`（0001） | CASCADE | 来店履歴・通知履歴・感想が消える（感想は本人の希望で決める＝7.3） |

代わりに、個人を識別できる**2列だけ**を復元できない値に置き換える:

| 列 | 置き換え後 | 理由 |
|---|---|---|
| `line_user_id`（`not null unique`） | `'withdrawn:' \|\| gen_random_uuid()` | **ランダム値**にする（元の ID のハッシュにしない＝同じ人が再び現れても突き合わせられない）。unique を満たし、LINE ID の形式（`U`＋16進32桁）とも衝突しない。`withdrawn:` の接頭辞で退会済みを SQL から判別できる |
| `display_name`（`not null`） | `'退会済みのお客様'` | 感想・評価の画面は投稿者名を `customers.display_name` から都度読んでいる（`inbox-data.ts`・`dashboard-data.ts`・`staff/received/[reviewId]/page.tsx`）＝**感想を残す場合も表示は自動でこの文言になる** |

あわせて `line_is_friend` を `false` にし、未送信の来店リマインド（`notification_outbox` の `pending`）を閉じる。

これで audit_log・取引の記録・特典の履歴に残るのは `customer_id`（UUID）だけになり、
その UUID の先の `customers` 行に個人を識別できる値が無い状態になる
（audit_log の中身は §5 補足・2026-09-24 再確認）。

### 7.2 申出の受付

1. info@echo-thanks.jp で申出を受ける。
2. **本人確認の方法：未決。**
   - 何を以て「申出者＝その `customers` 行の本人」とするかが決まっていない。
   - **対象の行を特定する手段も未決**。`display_name` は一意ではなく、お客様の画面には
     `customer_id` も LINE ID も表示していない。メールだけでは行を1つに絞れない。
   - **決まるまでは、行を1つに確定できない申出は処理しない**（取り違えて別人を退会させると戻せない）。
3. 受付日・対応者・（確定後の）`customer_id` を記録する。**記録の置き場所は未決**
   （audit_log や `stamp_adjustments.note` には書かない＝§5-3）。

### 7.3 感想の扱いの希望を聞く

第7条は、投稿済みの感想について「**削除する**」か「**投稿者を特定できない形式で掲載を続ける**」かを
お客様が選べると約束している。**処理の前に必ず希望を聞く。**

| 希望 | すること | 起きること |
|---|---|---|
| 掲載を続ける | 7.4 の SQL だけ（感想には触らない） | 投稿者名が「退会済みのお客様」になる。**本文はそのまま**＝本文に本人が分かる内容があれば残る。気になる場合は「削除」を案内する |
| 削除する | 7.4 の手順 1 で `reviews` を delete | `rating_purchases.review_id` は `on delete set null`（0001）＝**購入の記録は残り、感想との紐づけだけ外れる**。店舗・スタッフの感想件数が減る。`reviews` は監査対象外＝**削除の記録は audit_log に残らない** |

### 7.4 置き換えの SQL

`<CUSTOMER_ID>` を 7.2 で確定した uuid に置き換えて実行する。

**0) 処理前の件数を控える**（7.5 の確認で使う）

```sql
select
  (select count(*) from public.reviews            where customer_id = '<CUSTOMER_ID>') as reviews,
  (select count(*) from public.rating_purchases   where customer_id = '<CUSTOMER_ID>') as rating_purchases,
  (select count(*) from public.reward_redemptions where customer_id = '<CUSTOMER_ID>') as reward_redemptions,
  (select count(*) from public.earned_stamps      where customer_id = '<CUSTOMER_ID>') as earned_stamps,
  (select count(*) from public.stamp_adjustments  where customer_id = '<CUSTOMER_ID>') as stamp_adjustments,
  (select count(*) from public.visits             where customer_id = '<CUSTOMER_ID>') as visits,
  (select count(*) from public.notification_outbox
     where customer_id = '<CUSTOMER_ID>' and status = 'pending')                     as outbox_pending,
  (select line_user_id like 'withdrawn:%' from public.customers
     where id = '<CUSTOMER_ID>')                                                      as already_withdrawn;
```

`already_withdrawn` が `true` なら処理済み。**null なら行が無い**（uuid の誤り）。どちらも中断する。

**1)〜3) 本体**（1トランザクション。ガードに引っかかれば `raise exception` で全体が巻き戻る＝40 §1.12）

```sql
begin;

do $$
declare
  v_customer uuid := '<CUSTOMER_ID>';
  v_delete_reviews boolean := false;  -- ★7.3 で「削除」を希望された場合だけ true にする
  v_n int;
begin
  -- 対象が1行・未処理であること
  select count(*) into v_n from public.customers
   where id = v_customer and line_user_id not like 'withdrawn:%';
  if v_n <> 1 then
    raise exception '[withdraw] 対象が1行ではない、または処理済み（% 行）', v_n;
  end if;

  -- 1) 感想（希望が「削除」のときだけ）
  if v_delete_reviews then
    delete from public.reviews where customer_id = v_customer;
  end if;

  -- 2) 未送信の来店リマインドを閉じる
  --    skip_reason は CHECK で値が固定（0024・0044）。「LINE ID が無い」に当たる既存値を使う。
  update public.notification_outbox
     set status = 'skipped', skip_reason = 'no_line_user'
   where customer_id = v_customer and status = 'pending';

  -- 3) 識別子の置き換え（行は消さない）
  update public.customers
     set line_user_id   = 'withdrawn:' || gen_random_uuid()::text,
         display_name   = '退会済みのお客様',
         line_is_friend = false
   where id = v_customer and line_user_id not like 'withdrawn:%';
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception '[withdraw] customers の置き換えが1行ではない（% 行）', v_n;
  end if;
end $$;

commit;
```

### 7.5 処理後の確認

```sql
-- 置き換わっていること（値そのものは出さない）
select id,
       line_user_id like 'withdrawn:%'   as line_id_replaced,
       display_name = '退会済みのお客様' as name_replaced,
       line_is_friend
  from public.customers
 where id = '<CUSTOMER_ID>';
-- 期待: true / true / false
```

続けて、0) と同じ件数の SQL をもう一度流し、次を確かめる:

| 列 | 期待 |
|---|---|
| `rating_purchases`・`reward_redemptions`・`earned_stamps`・`stamp_adjustments`・`visits` | **0) と同じ**（履歴を消していない） |
| `reviews` | 「掲載を続ける」なら 0) と同じ／「削除」なら **0** |
| `outbox_pending` | **0** |
| `already_withdrawn` | **true** |

最後に、申出者へ処理の完了を返信する（文面は未決）。

### 7.6 処理後に起きること・限界

- **同じ人が再び LINE ログインすると、新しい `customers` 行ができる。**
  コード上の根拠: ログイン時の登録は `line_user_id` の衝突時に何もしない upsert
  （`api/auth/line/callback/route.ts:168-170`・`onConflict: "line_user_id", ignoreDuplicates: true`）。
  元の LINE ID はもう DB に無いので、**挿入が通って別人扱いの新しい行になる**（過去の履歴は引き継がない）。
  **【推測・本番で未検証】** 実際に退会処理した人の再ログインはまだ観測していない。
- **処理前に発行済みのセッションは、最長30日間そのまま使える。**
  セッションは `customer_id` と `line_user_id` を入れた署名付き JWT（`src/lib/session.ts`・
  `SESSION_MAX_AGE` 30日）で、`getSession()` は DB を照会しない。
  **【推測】** その端末では、置き換え後の行（表示名「退会済みのお客様」）として `/mypage` が開き、
  感想の投稿などもその行に紐づいてしまう可能性がある。サーバー側で個別に無効化する手段は無い
  （`SESSION_SECRET` を変えると**全員**がログアウトする）。
  当面は、申出者にホーム画面（`/`）の「ログアウト」を案内する（`src/app/page.tsx:55`）。
- LINE の友だち登録・ブロックの webhook は `line_user_id` で `customers` を引くため、
  処理後は該当行が無いものとして扱われる（`api/line/webhook/route.ts` の unknown 経路）。
- **Stripe 側の記録は対象外。** echo の `stripe_events.payload` には名前・メール・電話・住所の値が
  無いことを確認した（2026-09-24・32件）。Stripe 自体が保持する決済情報の扱いは未確認。
