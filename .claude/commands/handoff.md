---
description: docs/HANDOFF.md を再生成する（git log と docs/ から引き継ぎメモを自動作成）
allowed-tools: Bash(git log:*), Bash(git rev-parse:*), Bash(git show:*), Bash(grep:*), Bash(sed:*), Bash(head:*), Bash(tail:*), Bash(wc:*), Bash(date:*), Bash(ls:*), Read, Write
---

# /handoff — 引き継ぎメモの自動生成

`docs/HANDOFF.md` を**上書き生成**する。手書きしない。

**この作業で変更してよいのは `docs/HANDOFF.md` ただ1つ。**
コード・migration・他の docs・`.claude/` は読むだけで、**絶対に変更しない**。
commit も push もしない（生成して報告するまで）。

---

## 手順

### 1. 期間を決める

```
前回生成日時 = docs/HANDOFF.md の「生成日時」行（無ければ初回）
```

- **2回目以降**: 前回の「HEAD」に記録された commit の次から `HEAD` まで
  → `git log <前回HEAD>..HEAD --oneline`
- **初回**（`docs/HANDOFF.md` が無い）: 直近2週間
  → `git log --since="2 weeks ago" --oneline`

現在の HEAD は `git rev-parse --short HEAD` で取る。

### 2. commit を読む

```
git log <範囲> --format="%h %ad %s" --date=short
```

本文まで要る場合のみ `git show --stat --format=%B <hash>` を使う。
**差分そのものは読まない**（要約であって変更履歴の複製ではない）。

### 3. docs を読む

`docs/00_philosophy.md` `10_domain.md` `20_product.md` `30_design.md`
`40_decisions.md` `50_security.md` `60_incidents.md` を読み、**決定事項とその状態**を拾う。

特に見るもの:
- `40_decisions.md` の各節の「決定」「未対応・確認事項」「未確認」
- `60_incidents.md` の「残課題」
- 「未実施」「未着手」「未確認」「要確認」「TODO」を含む行

### 4. 書く

下記の構成で `docs/HANDOFF.md` を**上書き**する。

---

## HANDOFF.md の構成

```markdown
# 引き継ぎメモ（自動生成）

> `/handoff` が生成。**手で編集しない**（次回の生成で消える）。
> 生成日時: YYYY-MM-DD HH:MM JST
> HEAD: <short hash>
> 対象範囲: <前回HEAD>..HEAD ／ または「初回・直近2週間」

## この期間に完了したこと
| commit | 内容 | 根拠(docs) |

## 残タスク
### 実装済み（commit hash 必須）
### 決定済み・未実装（docs の節番号 必須）
### 未確認（出典なし）

## 本番で未確認
（コードはあるが実機確認の記録が docs に無いもの）

## docs と実装の食い違い

## 運用メモ
（docs に書かれているものだけ）

---
未確認: N 件 ／ 食い違い: M 件
```

---

## ルール（厳守）

1. **出典が書けない項目は必ず「未確認」に入れる。**
   commit hash も docs の節番号も示せないものを、他のセクションに書かない。
2. **推測で埋めない。** 「たぶん」「〜と思われる」は書かない。
   根拠が無いなら「未確認」に、根拠のある事実だけを書く。
3. **食い違いは両論併記。** docs の記述と実装が違う場合、
   **どちらかに寄せず両方を書き**、「食い違い」と明示する。修正もしない。
4. **150行以内。** 超えたら各項目を1行に圧縮する。
   docs の複製ではなく**要約**。詳細は節番号で参照させる。
5. **日時は JST**（`TZ=Asia/Tokyo date "+%Y-%m-%d %H:%M"`）。
6. 生成後、**未確認の件数と食い違いの件数を報告する**。

## 出力

`docs/HANDOFF.md` を Write で上書きしたあと、
- 生成した本文をそのまま提示する
- 行数を報告する（150行以内であること）
- **未確認 N 件 / 食い違い M 件** を報告する
