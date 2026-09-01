import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";
import { Eyebrow, Card } from "@/components/ui";
import { REVIEW_RATINGS } from "@/lib/review";
import InboxList, { type InboxRow } from "./InboxList";
import SalonNav from "@/components/SalonNav";
import { resolveSalonRole } from "@/lib/display-role";

/**
 * 11 店長 Inbox（画面マップ11・サロンUI世界）。ルート: /manager/inbox
 *
 * 同サロンの感想を新着順に一覧。各行を [全員に共有 / 店長控え] でキュレーション（reviews.visibility）。
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
  visibility: string | null;
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

  // visibility 列（migration 0006）。未適用環境でも壊れないよう、エラー時は列なしで再取得する。
  const fetchRows = (cols: string) =>
    supabaseAdmin
      .from("reviews")
      .select(cols)
      .eq("salon_id", salonId)
      .order("created_at", { ascending: false })
      .limit(50);

  let migrationMissing = false;
  let res = await fetchRows(
    "id, body, rating, created_at, visibility, staff(name), customers(display_name)",
  );
  if (res.error) {
    migrationMissing = true;
    res = await fetchRows(
      "id, body, rating, created_at, staff(name), customers(display_name)",
    );
  }

  const rawRows = (res.data ?? []) as unknown as Row[];

  const rows: InboxRow[] = rawRows.map((r) => {
    const visibility = r.visibility === "manager" ? "manager" : "all";
    return {
      id: r.id,
      emoji: RATING_EMOJI.get(r.rating ?? -1) ?? "♥",
      staffName: one(r.staff)?.name ?? "サロン全体",
      customerName: one(r.customers)?.display_name ?? "お客様",
      time: jstStamp.format(new Date(r.created_at)),
      body: r.body,
      visibility,
    };
  });

  const sharedCount = rows.filter((r) => r.visibility === "all").length;
  const heldCount = rows.filter((r) => r.visibility === "manager").length;

  const displayRole = await resolveSalonRole(ctx);

  return (
    <main className="page page-top" data-role={displayRole}>
      <div className="container stack animate-in">
        <SalonNav role={displayRole} />
        <header className="stack-sm">
          <Eyebrow className="eyebrow-mint">Manager inbox</Eyebrow>
          <h1 className="headline">{salon.name} ・ 感想の一覧</h1>
        </header>

        {migrationMissing && (
          <div className="notice notice-error">
            visibility 列が未適用です。Supabase SQLエディタで
            <code> supabase/migrations/0006_review_visibility.sql </code>
            を適用すると、各行のトグルが保存されます（現在は表示のみ）。
          </div>
        )}

        <div className="inbox-stat-row">
          <span className="inbox-stat">
            <span className="inbox-stat-label">全員に共有</span>
            <span className="inbox-stat-value">{sharedCount}</span>
          </span>
          <span className="inbox-stat">
            <span className="inbox-stat-label">店長控え</span>
            <span className="inbox-stat-value">{heldCount}</span>
          </span>
        </div>

        <Card>
          {rows.length === 0 ? (
            <p className="muted center-text">まだ感想は届いていません。</p>
          ) : (
            <InboxList rows={rows} />
          )}
        </Card>

        <p className="note-fine">
          「店長控え」にした感想はスタッフ本人の画面には表示されません。金額はこの画面では扱いません（原則5）。
        </p>
      </div>
    </main>
  );
}
