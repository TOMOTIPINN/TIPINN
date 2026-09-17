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
};

const SCOPE_LABEL = new Map<string, string>(
  SHARE_SCOPES.map((s) => [s.value, s.label]),
);

/**
 * 公開範囲のバッジ。
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
 */
function ScopeBadge({ scope }: { scope: string | null }) {
  const label = scope ? SCOPE_LABEL.get(scope) : undefined;
  if (!label) return null;
  return (
    <div className="inbox-scope">
      <span className="tag-quiet">{label}</span>
    </div>
  );
}

export default function InboxList({ rows }: { rows: InboxRow[] }) {
  return (
    <div>
      {rows.map((r) => (
        <div key={r.id} className="inbox-row">
          <div className="inbox-meta">
            <span className="inbox-emoji" aria-hidden="true">
              {r.emoji}
            </span>
            <span className="inbox-staff">{r.staffName}</span>
            <span className="inbox-customer">{r.customerName}様</span>
            <span className="inbox-time">{r.time}</span>
          </div>
          <ScopeBadge scope={r.shareScope} />
          <p className="inbox-body">「{r.body}」</p>
        </div>
      ))}
    </div>
  );
}
