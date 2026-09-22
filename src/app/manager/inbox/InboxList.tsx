import Link from "next/link";
import { SHARE_SCOPES } from "@/lib/review";

/**
 * 店長Inbox の感想リスト（表示専用・サーバーコンポーネント）。
 *
 * ★§16（2026-09-17）でトグルを廃止した★
 *   以前は各行に [全員に共有 / 店長控え] のトグルを持ち、reviews.visibility を
 *   更新していた（クライアントコンポーネント）。visibility はスタッフ側の表示判定
 *   （@/lib/review-visibility）にも購入条件（@/lib/review-purchase）にも使われて
 *   おらず、「店長控え＝スタッフに表示されない」という画面の説明と実装が
 *   食い違っていた（2026-09-17 調査）。→ docs/40_decisions.md §16
 *
 *   いまこの行に出るのは **お客様が選んだ公開範囲（share_scope）** で、
 *   店長は変更できない。対話要素が無くなったので "use client" も外した。
 *
 * 文言は @/lib/review の SHARE_SCOPES を正とする（お客様が感想フォームで見た
 * 選択肢とまったく同じ文字列を店長にも見せる）。'everyone' を「全体に公開」等と
 * 言い換えない — 外部公開ではないため（review.ts の SHARE_SCOPES 直上のコメント）。
 *
 * ★§20 決定1（2026-09-22）でティアバッジを足した★
 *   その感想に付いた評価スタンプのティア名（Thank you 等）を、公開範囲の隣に出す。
 *   色は公開範囲と**同じ褪せグレー（.tag-quiet）**で、ティアによって出し分けない
 *   （高ティアを強調しない＝§20 ガードレール3。ティアはどれが good でもない）。
 *   受け取るのはラベル文字列だけで、金額は受け取らない。
 *
 * ★§20 決定2（2026-09-22）で各行を詳細（/staff/received/[reviewId]）へのリンクにした★
 *   §16・§17 が範囲外としていた「Inbox の行から詳細への導線」を解消する。
 *   行全体を Link にする（/staff の Team voices の行と同じ作り）。リンクの色・下線は
 *   グローバルの `a { color: inherit; text-decoration: none; }` でリセット済みで、
 *   **ミントにはしない**。詳細画面は manager なら同サロンで full（権限判定は変えていない）。
 *
 * 視覚は globals.css のトークンのみ（インラインstyle禁止・30_design §7）。
 * ¥は受け取らない・表示しない（原則5）。
 */
export type InboxRow = {
  id: string;
  emoji: string;
  staffName: string;
  customerName: string;
  time: string;
  body: string;
  /** お客様が選んだ公開範囲。'everyone' | 'manager_only' 以外（null / 'either'）もあり得る。 */
  shareScope: string | null;
  /** その感想に付いた評価スタンプのティア名。購入なし・過去21件（review_id null）は null。 */
  tierLabel: string | null;
};

const SCOPE_LABEL = new Map<string, string>(
  SHARE_SCOPES.map((s) => [s.value, s.label]),
);

/**
 * 公開範囲とティアのバッジの段。
 *
 * **既知の値だけを明示的に判定し、それ以外はバッジを出さない。**
 *   `10_domain.md` は `either` を廃止済みとするが RPC 0046 は今も受理する
 *   （本番 prosrc は未確認・HANDOFF 食い違い#1）。`neq('manager_only')` のような
 *   二分法にすると未知の値が黙ってどちらかに寄り、画面が食い違いを隠してしまう。
 *   出さないことで異常が見えるようにする。
 *
 * 色は **両方とも同じ褪せグレー（.tag-quiet）**。
 *   お客様の選択に優劣をつけないため、`everyone` を目立たせない。
 *   ミントは「ブランド＋好調/上昇」の差し色（docs/30_design.md §2）で、
 *   公開範囲はどちらが good でもないので使わない。**赤も使わない**（同§2）。
 *
 * 位置は **常に名前の下の段（.inbox-scope）**。上段（.inbox-meta）に混ぜると
 * 名前の長さで横に並んだり下に落ちたりして、行ごとに位置が変わる。
 *
 * ティア（§20 決定1）も同じ段・同じ .tag-quiet で公開範囲の隣に並べる。
 * **どちらも無い行では段そのものを描かない**（空の段を描くと .inbox-row の gap の分だけ
 * 行が高くなる）。
 */
function RowBadges({
  scope,
  tierLabel,
}: {
  scope: string | null;
  tierLabel: string | null;
}) {
  const scopeLabel = scope ? SCOPE_LABEL.get(scope) : undefined;
  if (!scopeLabel && !tierLabel) return null;
  return (
    <div className="inbox-scope">
      {scopeLabel && <span className="tag-quiet">{scopeLabel}</span>}
      {tierLabel && <span className="tag-quiet">{tierLabel}</span>}
    </div>
  );
}

export default function InboxList({ rows }: { rows: InboxRow[] }) {
  return (
    <div>
      {rows.map((r) => (
        <Link
          key={r.id}
          href={`/staff/received/${r.id}`}
          className="inbox-row"
        >
          <div className="inbox-meta">
            <span className="inbox-emoji" aria-hidden="true">
              {r.emoji}
            </span>
            <span className="inbox-staff">{r.staffName}</span>
            <span className="inbox-customer">{r.customerName}様</span>
            <span className="inbox-time">{r.time}</span>
          </div>
          <RowBadges scope={r.shareScope} tierLabel={r.tierLabel} />
          <p className="inbox-body">「{r.body}」</p>
        </Link>
      ))}
    </div>
  );
}
