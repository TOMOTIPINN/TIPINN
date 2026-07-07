import { Eyebrow } from "@/components/ui";

/**
 * サロンUIの上部ロールバー（§12）。現在の権限を斜体英字で示す：*Staff / Manager / Owner*。
 *
 * - customer（白の世界）には出さない＝呼び出し側で RoleBar を描画しない（役割自体を渡さない）。
 * - 色は data-role → --accent（globals.css）に委譲：staff=mint / manager=濃mint / owner=bronze。
 *   ラベルは Eyebrow（.eyebrow）を再利用し、`.role-bar-label` で色だけ --accent に上書きする。
 * - owner は staff.role に無い「表示上の役割」（そのサロンで最初の manager＝owner と判定・DBカラム追加なし）。
 *   判定は呼び出し側（server page）で解決し、ここには確定した SalonRole を渡す。
 * - 純粋な表示コンポーネント（データ取得なし）。インラインstyle禁止（§8・トークンのみ）。
 */
export type SalonRole = "staff" | "manager" | "owner";

const LABEL: Record<SalonRole, string> = {
  staff: "Staff",
  manager: "Manager",
  owner: "Owner",
};

export default function RoleBar({ role }: { role: SalonRole }) {
  return (
    <div
      className="role-bar"
      data-role={role}
      role="note"
      aria-label={`現在の権限: ${LABEL[role]}`}
    >
      <Eyebrow className="role-bar-label">{LABEL[role]}</Eyebrow>
    </div>
  );
}
