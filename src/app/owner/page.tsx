import { requireOwnerPage } from "@/lib/owner-guard";
import { Eyebrow, Card } from "@/components/ui";
import RoleBar from "@/components/RoleBar";

/**
 * オーナートップ（/owner・§21 コミット3a）。
 *
 * ★3a は認可の骨格だけ★
 *   出すのは**組織名と配下の店舗名だけ**。数字・リンク・スタッフ情報は一切出さない。
 *   店舗単位の比較（§21 決定3）は**コミット3d**、店舗ごとの中身は
 *   `/owner/[salonId]/dashboard` ・ `/owner/[salonId]/inbox`（**コミット3b 以降**）で作る。
 *   ここで数字を出さないのは、ガードの挙動だけを本番で確かめられるようにするため（§6.4）。
 *
 * 認可: `requireOwnerPage()`（未ログイン→LINEログイン／非オーナー→/staff）。
 *   判定は `organization_members` のみで、`staff.role` は見ない（§21 決定2）。
 *   **layout.tsx には置かない**（既存の作法どおり page の冒頭で行う）。
 *
 * トーン: サロンUI。ロールは常に owner＝`data-role="owner"` で --accent は bronze
 *   （globals.css `[data-role="owner"]`）。ここに来られる人は定義上オーナーなので
 *   `resolveSalonRole` は呼ばない（あれはサロン単位の表示解決）。
 *   ¥なし・赤なし・インラインstyle禁止（トークンのみ・§8）。
 *
 * ナビ（SalonNav）は出さない。あれは単一サロンの店長導線（/dashboard・/manager/*）で、
 * 複数店舗を持つ /owner の文脈には合わない。店舗への導線はコミット3b で足す。
 */
export const dynamic = "force-dynamic";

export default async function OwnerHomePage() {
  const ctx = await requireOwnerPage("/owner");

  return (
    <main className="page page-top" data-role="owner">
      <div className="container stack animate-in">
        <RoleBar role="owner" />

        <header className="stack-sm">
          <Eyebrow className="eyebrow-mint">Owner</Eyebrow>
          <h1 className="headline">{ctx.org_name}</h1>
          <p className="muted">
            この会社が運営している店舗です。店舗ごとの数字はこのあと見られるようになります。
          </p>
        </header>

        <Card>
          {ctx.salons.length === 0 ? (
            <p className="muted center-text">
              まだ店舗が登録されていません。
            </p>
          ) : (
            <div className="stack-sm">
              {/* 並びは salons.created_at 昇順（暫定）。正式な並び順は §21 コミット3d で決める。 */}
              {ctx.salons.map((salon) => (
                <p key={salon.id} className="headline-sm">
                  {salon.name}
                </p>
              ))}
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
