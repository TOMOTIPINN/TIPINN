import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";
import { Eyebrow, Card } from "@/components/ui";
import { REVIEW_RATINGS, SHARE_SCOPES } from "@/lib/review";
import InboxList, { type InboxRow } from "./InboxList";
import SalonNav from "@/components/SalonNav";
import { resolveSalonRole } from "@/lib/display-role";

/**
 * 11 店長 Inbox（画面マップ11・サロンUI世界）。ルート: /manager/inbox
 *
 * 同サロンの感想を新着順に一覧（最新50件）。各行には **お客様が選んだ公開範囲
 * （reviews.share_scope）** を表示する。**店長はこれを変更できない**。
 *
 * ★§16（2026-09-17）で店長のキュレーションを廃止した★
 *   以前は各行に [全員に共有 / 店長控え] のトグルがあり reviews.visibility を更新していたが、
 *   visibility はスタッフ側の表示判定（@/lib/review-visibility）にも購入条件
 *   （@/lib/review-purchase）にも使われておらず、「店長控え＝スタッフに表示されない」という
 *   この画面の説明と実装が食い違っていた（2026-09-17 調査）。
 *   低評価の言葉は店長が受け止め（docs/00_philosophy.md §4.8）、`manager_only` はお客様の選択で
 *   すでに担保されている。表示条件に「店長の判断」という3つ目の軸を足さない。
 *   → docs/40_decisions.md §16。**visibility 列は DB に残すが読み書きしない。**
 *
 * トーン: 暖色＋ミント・ゴシック・**¥なし**（金額は select しない・§4）。
 *
 * 認証（方式B / [[auth-method-line-b]]）: ログイン中の LINE から getStaffContext() を解決。
 *   未ログイン → returnTo付きで LINE ログインへ。role!=='manager' は閲覧不可。
 *   サロンは ctx.salon_id にスコープ（?salon= は受け取らない＝越境不可）。
 */

type Row = {
  id: string;
  body: string;
  rating: number | null;
  created_at: string;
  share_scope: string | null;
  staff: { name: string } | { name: string }[] | null;
  customers: { display_name: string } | { display_name: string }[] | null;
};

function one<T>(v: T | T[] | null): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

const RATING_EMOJI = new Map<number, string>(
  REVIEW_RATINGS.map((r) => [r.value, r.emoji]),
);

const jstStamp = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function ManagerInboxPage() {
  const session = await getSession();
  if (!session) {
    redirect(
      `/api/auth/line/login?returnTo=${encodeURIComponent("/manager/inbox")}`,
    );
  }

  const ctx = await getStaffContext();
  if (!ctx) {
    return (
      <main className="page">
        <p className="muted center-text">
          このアカウントはスタッフとして登録されていません。
        </p>
      </main>
    );
  }
  if (ctx.role !== "manager") {
    return (
      <main className="page">
        <p className="muted center-text">
          この画面は店長のみ閲覧できます。
        </p>
      </main>
    );
  }

  const salonId = ctx.salon_id;
  const { data: salon } = await supabaseAdmin
    .from("salons")
    .select("name")
    .eq("id", salonId)
    .single();

  if (!salon) {
    return (
      <main className="page">
        <p className="muted center-text">サロンが見つかりませんでした。</p>
      </main>
    );
  }

  // 一覧は新着50件（ページングは持たない・§16 で範囲外とした）。
  // share_scope は 0001 からある中核列なので、フォールバックの再取得はしない
  // （/staff も @/lib/review-server も同様にそのまま select している）。
  const res = await supabaseAdmin
    .from("reviews")
    .select(
      "id, body, rating, created_at, share_scope, staff(name), customers(display_name)",
    )
    .eq("salon_id", salonId)
    .order("created_at", { ascending: false })
    .limit(50);

  const rawRows = (res.data ?? []) as unknown as Row[];

  const rows: InboxRow[] = rawRows.map((r) => ({
    id: r.id,
    emoji: RATING_EMOJI.get(r.rating ?? -1) ?? "♥",
    staffName: one(r.staff)?.name ?? "サロン全体",
    customerName: one(r.customers)?.display_name ?? "お客様",
    time: jstStamp.format(new Date(r.created_at)),
    body: r.body,
    shareScope: r.share_scope,
  }));

  /**
   * 上部の件数は **サロン全体** を数える（一覧の50件ではない・§16 決定3）。
   *   一覧は limit(50) なので、そこを母集団にすると 53 件あるサロンでも「50」と出続け、
   *   SQL と永久に一致しない（この食い違いが §16 の発端）。全体を数えれば
   *   `select share_scope, count(*) … group by 1` とそのまま突き合わせられる。
   *   本文は引かないので head:true の件数のみ（/staff の集計と同じパターン）。
   *
   * **既知の2値を明示的に数える**（`neq` で二分しない）。合計が全件に届かなければ
   * 未知の share_scope（`either` 等）が残っているサインになる → HANDOFF 食い違い#1。
   */
  const countByScope = (scope: string) =>
    supabaseAdmin
      .from("reviews")
      .select("id", { count: "exact", head: true })
      .eq("salon_id", salonId)
      .eq("share_scope", scope);

  const [everyoneRes, managerOnlyRes] = await Promise.all([
    countByScope("everyone"),
    countByScope("manager_only"),
  ]);
  const everyoneCount = everyoneRes.count ?? 0;
  const managerOnlyCount = managerOnlyRes.count ?? 0;

  const displayRole = await resolveSalonRole(ctx);

  return (
    <main className="page page-top" data-role={displayRole}>
      <div className="container stack animate-in">
        <SalonNav role={displayRole} />
        <header className="stack-sm">
          <Eyebrow className="eyebrow-mint">Manager inbox</Eyebrow>
          <h1 className="headline">{salon.name} ・ 感想の一覧</h1>
        </header>

        <div className="inbox-stat-row">
          {SHARE_SCOPES.map((s) => (
            <span className="inbox-stat" key={s.value}>
              <span className="inbox-stat-label">{s.label}</span>
              <span className="inbox-stat-value">
                {s.value === "manager_only" ? managerOnlyCount : everyoneCount}
              </span>
            </span>
          ))}
        </div>

        <Card>
          {rows.length === 0 ? (
            <p className="muted center-text">まだ感想は届いていません。</p>
          ) : (
            <InboxList rows={rows} />
          )}
        </Card>

        <p className="note-fine">
          件数はこのサロンの全件です。一覧は新着50件まで表示します。
          公開範囲はお客様が選んだもので、店長は変更できません。金額はこの画面では扱いません（原則5）。
        </p>
      </div>
    </main>
  );
}
