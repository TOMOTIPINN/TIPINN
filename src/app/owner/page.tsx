import Link from "next/link";
import { requireOwnerPage } from "@/lib/owner-guard";
import { Card } from "@/components/ui";
import RoleBar from "@/components/RoleBar";

/**
 * オーナートップ（/owner・§21 コミット3a → 3b でリンク化）。
 *
 * ★出すのは組織名と配下の店舗名だけ★
 *   数字・スタッフ情報はここには出さない。店舗単位の比較（§21 決定3）は**コミット3d**。
 *   店舗名は `/owner/[salonId]/dashboard` へのリンク（コミット3b）。
 *   `/owner/[salonId]/inbox` はコミット3c。
 *   **`/manager/*` ・ `/staff/*` への導線はこの画面から出さない。**
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

        {/* ロール表示は RoleBar（"Owner"）が担う。ここに Eyebrow で "Owner" を重ねない。 */}
        <header className="stack-sm">
          <h1 className="headline">{ctx.org_name}</h1>
          <p className="muted">
            この会社が運営している店舗です。店舗名を選ぶと、その店舗の数字を見られます。
          </p>
        </header>

        <Card>
          {ctx.salons.length === 0 ? (
            <p className="muted center-text">
              まだ店舗が登録されていません。
            </p>
          ) : (
            <div className="stack stack-sm">
              {/* ★`stack` を必ず併記する★ `.stack-sm` は gap だけの修飾クラスで、
                  単体ではコンテナが flex にならない（globals.css の `.stack` / `.stack-sm`）。
                  `p`（block）だったときは偶然1行ずつ並んでいたが、3b で `Link`（inline）に
                  したことで横につながった。

                  並びは salons.created_at 昇順（暫定）。正式な並び順は §21 コミット3d で決める。
                  リンク先は /owner/[salonId]/dashboard のみ。/manager ・ /staff へは出さない。
                  `btn btn-outline btn-block` で行全体がタップ領域になる（既存トークンのみ）。 */}
              {ctx.salons.map((salon) => (
                <Link
                  key={salon.id}
                  href={`/owner/${salon.id}/dashboard`}
                  className="btn btn-outline btn-block"
                >
                  {salon.name}
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
