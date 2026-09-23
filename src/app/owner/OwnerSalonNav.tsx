import Link from "next/link";
import RoleBar from "@/components/RoleBar";

/**
 * オーナーが1店舗を見ているときの共通ナビ（§21 コミット3c）。
 *
 * ★`SalonNav` は使わない★
 *   あれは単一サロンの店長導線で、`/dashboard`・`/manager/inbox`・`/manager/staff`・
 *   `/staff/visit` と設定5件（`/manager/profile` 等）へリンクする。
 *   `/owner` は **`/manager/*` ・ `/staff/*` への導線を出さない**（§8.1「店舗の設定・
 *   スタッフ招待は各店長が `/manager` で行う」）ので、行き先を自前で持つ。
 *
 * 出すのは3つだけ:
 *   - ロールバー（常に Owner＝bronze）
 *   - 「← 店舗一覧へ」（/owner に戻る）
 *   - その店舗の「数字」（dashboard）と「感想」（inbox）の行き来
 *
 * 見た目は既存トークンのみ（`.seg` / `.seg-btn` / `.is-active`＝§12 アクティブタブのミント）。
 * `.seg-btn` は要素を選ばないので `<Link>` にそのまま当たる。インライン style 禁止（§8）。
 *
 * ★`stack` を必ず併記する★ `.stack-sm` は gap だけの修飾クラスで、単体では
 *   コンテナが flex にならない（`4e3d8a0` で踏んだ落とし穴）。
 */
export default function OwnerSalonNav({
  salonId,
  active,
}: {
  salonId: string;
  active: "dashboard" | "inbox";
}) {
  const tabs = [
    { key: "dashboard" as const, href: `/owner/${salonId}/dashboard`, label: "数字" },
    { key: "inbox" as const, href: `/owner/${salonId}/inbox`, label: "感想" },
  ];

  return (
    <div className="stack stack-sm">
      <RoleBar role="owner" />
      <div className="seg" role="group" aria-label="この店舗の表示切替">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={`seg-btn${t.key === active ? " is-active" : ""}`}
            aria-current={t.key === active ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </div>
      <Link href="/owner" className="note-fine">
        ← 店舗一覧へ
      </Link>
    </div>
  );
}
