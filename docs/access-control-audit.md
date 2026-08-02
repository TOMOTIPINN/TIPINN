# アクセス制御 棚卸し（`src/app/**/page.tsx` 全25枚）

- 調査日: 2026-08-02
- 対象コミット: `e6f1e38`
- 方法: 静的読み取りのみ（`find` / `grep` / ソース精読）。**コードは一切変更していない。**

---

## 全体像

`src/app/` 配下の `page.tsx` は **25枚**。ガードは**すべてページ本体に個別実装**されている。
`manager/layout.tsx`・`staff/layout.tsx`・`kiosk/layout.tsx` は **PWA manifest / icons を差し替えるだけの pass-through** で、認可は一切持っていない。

`requireManager()`（`@/lib/manager-guard`）は **`/api/manager/*` 専用**で、ページからは1枚も呼ばれていない
（`dashboard/page.tsx` の grep ヒットはコメント内の言及のみ）。

---

## 顧客世界（白）

| ルートパス | 想定閲覧者 | ガード方式 | 判断 |
|---|---|---|---|
| `/` | 未認証可 | `getSession()` — **redirect なし**、ログイン状態で出し分け | ✅ 意図的な公開ページ。ログイン時のみ `customers.display_name` を取得 |
| `/mypage` | 一般客 | `getSession()` → login（`returnTo=/mypage`）／氏名未登録なら `/onboarding/name` | ✅ |
| `/review` | 一般客 | `getSession()` → login（`returnTo` に salon 保持） | ✅ |
| `/review/complete` | 一般客 | `getSession()` → login／`salonId` 欠落で `/` | ✅ |
| `/rating` | 一般客 | `getSession()` → login（salon/staff/reviewed を returnTo に保持） | ✅ |
| `/rating/complete` | 一般客 | `getSession()` → login（returnTo なし） | ✅ DB 書き込みなし（記録は webhook） |
| `/visit` | 一般客 | `getSession()` → login ＋ **`salons.visit_token` 突合**（不一致は記録せずエラー表示） | ✅ 二段。店頭QR の salon token が実質の認可 |
| `/onboard` | 一般客 | `getSession()` → login（salon/t 保持） | ✅ |
| `/onboarding/name` | 一般客 | `getSession()` → login／登録済みなら `safeReturn` へ | ✅ |

## スタッフ世界

| ルートパス | 想定閲覧者 | ガード方式 | 判断 |
|---|---|---|---|
| `/staff` | staff | `getSession()` → login ＋ `getStaffContext()` — null は案内文表示 | ✅ |
| `/staff/visit` | staff / 受付端末 | **`getVisitContext()`**（staff cookie or device cookie）→ なければ `getSession()` → login | ✅ 端末経路は LINE に飛ばさない設計 |
| `/staff/join` | 未認証可（招待） | `getSession()` → login ＋ `resolveStaffByLineUserId()` ＋ 招待トークン検証 | ✅ 招待トークンが認可の本体 |
| `/staff/received/[reviewId]` | staff / manager | `getSession()` ＋ `getStaffContext()` ＋ **所有権チェック**（`staff_id === ctx.staff_id` \|\| `manager && salon_id === ctx.salon_id`）、不一致は存在を伏せる | ✅ 唯一 IDOR 対策が明示されている画面 |

## 店長世界

| ルートパス | 想定閲覧者 | ガード方式 | 判断 |
|---|---|---|---|
| `/manager/inbox` | manager | session → `getStaffContext()` → `role !== "manager"` で**案内文表示** | ✅ |
| `/manager/profile` | manager | 同上（案内文） | ✅ |
| `/manager/rewards` | manager | 同上（案内文） | ✅ |
| `/manager/staff` | manager | 同上（案内文） | ✅ |
| `/manager/staff/[id]` | manager | 同上（案内文）＋ 以降 `ctx.salon_id` スコープ | ✅ |
| `/manager/visit` | manager | 同上（案内文） | ✅ |
| `/manager/onboard-qr` | manager | 同上（案内文） | ✅ |
| `/manager/kiosk` | manager | session → `!ctx \|\| role !== "manager"` で **`redirect("/staff")`** | ✅ |
| `/manager/salon/new` | manager ＋ **staff行ゼロの新規オーナー** | session → **`if (ctx && ctx.role !== "manager")`** のみ redirect ＝ **`ctx === null` は通す** | ✅ **意図的**。ヘッダーコメントに「最初の店を作る入口」と明記。作成時に API 側が作成者を manager 登録 |
| `/dashboard` | manager（オーナー） | session → `!ctx \|\| role !== "manager"` で `redirect("/staff")` | ✅ `/manager` 配下ではないが同等ガード |

## 端末・その他

| ルートパス | 想定閲覧者 | ガード方式 | 判断 |
|---|---|---|---|
| `/kiosk` | 受付端末（iPad） | **`getDeviceContext()` のみ**（device cookie 署名検証＋DB再照合）。LINE ログインには飛ばさない | ✅ 意図的。CLAUDE.md の設計どおり |
| `/demo` | 未認証可（営業デモ） | **セッションガードなし**。`isDemoLoginEnabled()`（`DEMO_LOGIN_ENABLED==="true"` ＋ `DEMO_LOGIN_SECRET` の二重 env ゲート）が false なら **`notFound()`** | ✅ **意図的な公開ページ**。本番 Prod env には値を置かない＝常に404。DB アクセスなし・シークレット入力フォームのみ（POST body 送信でクエリに残さない） |

---

## 所見

**1. 構造的リスク：ガードが layout ではなく全ページ個別。**
`/manager` 配下に新しい `page.tsx` を1枚足すと、**デフォルトでは完全に無防備**（layout は manifest しか持たないため）。
現状25枚は漏れなく守られているが、これは「毎回書いている」ことに依存した状態。
API 側は `requireManager()` に一本化されている一方、ページ側には同等の単一ソースが無い。

**2. 店長拒否の実装が2系統に分かれている。**
7枚が「案内文を return」、2枚（`/manager/kiosk`・`/dashboard`）が `redirect("/staff")`。
挙動として実害は無いが、判定式そのもの（`!ctx` と `role !== "manager"` を分けるか畳むか）も2通りあり、
CLAUDE.md の鉄則にある「導出ロジックの多重化」に近い形。

**3. `/manager/salon/new` の `ctx === null` 通過は意図的**とコメントで確認できた。
ただし他8枚と条件式の形が違うため、**将来この行をコピーして別ページに持ち込むと事故になり得る**箇所。
