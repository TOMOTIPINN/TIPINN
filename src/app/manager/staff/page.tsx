import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";
import {
  inviteUrl,
  isInviteActive,
  inviteRemainingHours,
} from "@/lib/staff-invite";
import { Eyebrow, Card } from "@/components/ui";
import SalonNav from "@/components/SalonNav";
import { LogoCircle } from "@/components/LogoCircle";
import CopyButton from "./CopyButton";

/**
 * A1 スタッフ管理（/manager/staff・サロンUI世界 / [[auth-method-line-b]]）。
 * 店長がスマホで：スタッフ名を追加 → その場で招待QR表示 → 新人が LINE スキャンで紐付け。
 *
 * 認可: 未ログイン→LINEログイン（returnTo）／非manager→閲覧不可。salon は ctx.salon_id にスコープ。
 * QR は招待URL（/staff/join?token=…）を qrcode でローカル生成（外部送信なし・原則7）。
 * トーン: ミント/ink・ゴシック・¥なし。インラインstyle禁止（globals.css のトークンのみ）。
 */
type StaffRow = {
  id: string;
  name: string;
  role: string;
  job_title: string | null;
  bio: string | null;
  photo_url: string | null;
  photo_pos_x: number;
  photo_pos_y: number;
  photo_zoom: number;
  line_user_id: string | null;
  invite_token: string | null;
  invite_expires_at: string | null;
  bound_at: string | null;
  created_at: string;
};

const ROLE_LABEL: Record<string, string> = { manager: "店長", staff: "スタッフ" };

export default async function ManagerStaffPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; reissued?: string }>;
}) {
  const { created, reissued } = await searchParams;

  const session = await getSession();
  if (!session) {
    redirect(
      `/api/auth/line/login?returnTo=${encodeURIComponent("/manager/staff")}`,
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
        <p className="muted center-text">この画面は店長のみ閲覧できます。</p>
      </main>
    );
  }

  const baseUrl = process.env.APP_BASE_URL!;

  const [{ data: salon }, { data: staffData }] = await Promise.all([
    supabaseAdmin.from("salons").select("name").eq("id", ctx.salon_id).single(),
    supabaseAdmin
      .from("staff")
      .select(
        "id, name, role, job_title, bio, photo_url, photo_pos_x, photo_pos_y, photo_zoom, line_user_id, invite_token, invite_expires_at, bound_at, created_at",
      )
      .eq("salon_id", ctx.salon_id)
      .order("created_at", { ascending: true }),
  ]);

  const staff = (staffData ?? []) as StaffRow[];

  // 状態判定（参加済み / 招待中 / 未参加）。招待中のみ QR を生成。
  type View = {
    row: StaffRow;
    state: "bound" | "invited" | "expired";
    qr?: string;
    hoursLeft?: number;
    url?: string;
  };
  const views: View[] = await Promise.all(
    staff.map(async (row): Promise<View> => {
      if (row.line_user_id) return { row, state: "bound" };
      if (!isInviteActive(row.invite_token, row.invite_expires_at)) {
        return { row, state: "expired" };
      }
      const url = inviteUrl(baseUrl, row.invite_token!);
      const qr = await QRCode.toDataURL(url, { margin: 1, width: 240 });
      return {
        row,
        state: "invited",
        qr,
        hoursLeft: inviteRemainingHours(row.invite_expires_at!),
        url,
      };
    }),
  );

  return (
    <main className="page page-top">
      <div className="container stack animate-in">
        <SalonNav />
        <header className="stack-sm">
          <Eyebrow className="eyebrow-mint">Staff invitations</Eyebrow>
          <h1 className="headline">{salon?.name ?? "サロン"} ・ スタッフ管理</h1>
        </header>

        {(created || reissued) && (
          <div className="notice notice-success">
            {created
              ? "新しいスタッフを追加しました。下のQRを本人に見せてください。"
              : "招待を再発行しました。新しいQRを本人に見せてください。"}
          </div>
        )}

        {/* 新規追加フォーム（送信→作成→/manager/staff?created= に戻りQR表示） */}
        <Card>
          <form action="/api/manager/staff" method="post" className="stack-md">
            <Eyebrow className="eyebrow-mint">Add staff</Eyebrow>
            <div className="field-group">
              <label className="field-label" htmlFor="name">
                スタッフ名
              </label>
              <input
                id="name"
                name="name"
                className="field"
                type="text"
                maxLength={50}
                required
                placeholder="例：山田 はな"
              />
            </div>
            <button type="submit" className="btn btn-outline btn-block">
              追加してQRを表示
            </button>
          </form>
        </Card>

        {/* 一覧（状態出し分け） */}
        <section className="stack">
          <Eyebrow className="eyebrow-mint">Staff（{staff.length}）</Eyebrow>
          {views.length === 0 ? (
            <Card>
              <p className="muted center-text">
                まだスタッフがいません。上のフォームから追加してください。
              </p>
            </Card>
          ) : (
            views.map((v) => (
              <Card key={v.row.id}>
                <div className="stack-md">
                  <div className="staff-admin-head">
                    <span className="staff-photo" aria-hidden="true">
                      <LogoCircle
                        logoUrl={v.row.photo_url}
                        x={v.row.photo_pos_x}
                        y={v.row.photo_pos_y}
                        zoom={v.row.photo_zoom}
                        fallback={v.row.name.slice(0, 3)}
                      />
                    </span>
                    <div className="staff-admin-id">
                      <span className="staff-admin-name">{v.row.name}</span>
                      {v.row.job_title && (
                        <span className="staff-admin-jobtitle">
                          {v.row.job_title}
                        </span>
                      )}
                    </div>
                    <span className="role-tag">
                      {ROLE_LABEL[v.row.role] ?? "スタッフ"}
                    </span>
                    {v.state === "bound" && (
                      <span className="status-pill is-bound">参加済み</span>
                    )}
                    {v.state === "invited" && (
                      <span className="status-pill">招待中</span>
                    )}
                    {v.state === "expired" && (
                      <span className="status-pill is-expired">未参加</span>
                    )}
                  </div>

                  {v.row.bio && <p className="staff-admin-bio">{v.row.bio}</p>}

                  <Link
                    href={`/manager/staff/${v.row.id}`}
                    className="btn btn-subtle btn-block"
                  >
                    プロフィールを編集
                  </Link>

                  {v.state === "invited" && (
                    <div className="qr-block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        className="qr-img"
                        src={v.qr}
                        alt={`${v.row.name} の招待QR`}
                      />
                      <p className="invite-expiry">
                        有効期限：あと約 {v.hoursLeft} 時間
                      </p>
                      <p className="invite-url">{v.url}</p>
                      <div className="invite-actions">
                        <CopyButton value={v.url!} />
                        <form action="/api/manager/staff/reissue" method="post">
                          <input type="hidden" name="staffId" value={v.row.id} />
                          <button type="submit" className="btn btn-subtle">
                            再発行
                          </button>
                        </form>
                      </div>
                    </div>
                  )}

                  {v.state === "expired" && (
                    <form action="/api/manager/staff/reissue" method="post">
                      <input type="hidden" name="staffId" value={v.row.id} />
                      <button type="submit" className="btn btn-subtle btn-block">
                        招待を発行（QRを表示）
                      </button>
                    </form>
                  )}
                </div>
              </Card>
            ))
          )}
        </section>

        <Link href="/manager/profile" className="btn btn-quiet btn-block">
          店舗プロフィール（ロゴ）へ
        </Link>

        <Link href="/manager/inbox" className="btn btn-quiet btn-block">
          店長 Inbox へ
        </Link>
      </div>
    </main>
  );
}
