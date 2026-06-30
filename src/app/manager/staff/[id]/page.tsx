import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";
import { Eyebrow, Card } from "@/components/ui";
import { StaffEditForm } from "./StaffEditForm";

/**
 * A2 スタッフ編集（/manager/staff/[id]・サロンUI世界 / [[auth-method-line-b]]）。
 * 店長がスタッフの写真・役職(job_title)・一言(bio)を編集する。
 *
 * 認可: 未ログイン→LINEログイン（returnTo）／非manager→閲覧不可。
 *       対象スタッフは必ず ctx.salon_id 所属のものだけ（越境防止）。
 * 保存は /api/manager/staff/update（service_role・サーバー側）。クライアント直叩きしない（§3・§8）。
 */
const ERROR_MESSAGE: Record<string, string> = {
  missing: "画像ファイルを選択してください。",
  type: "対応していない形式です。PNG / JPEG / WebP を選んでください。",
  size: "ファイルが大きすぎます（上限2MB）。",
  length: "文字数が上限を超えています。",
  upload: "アップロードに失敗しました。時間をおいて再度お試しください。",
  save: "保存に失敗しました。時間をおいて再度お試しください。",
};

export default async function StaffEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { id } = await params;
  const { saved, error } = await searchParams;

  const session = await getSession();
  if (!session) {
    redirect(
      `/api/auth/line/login?returnTo=${encodeURIComponent(`/manager/staff/${id}`)}`,
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

  // 対象スタッフは自分のサロン所属のものだけ取得（越境防止）。
  const { data: staff } = await supabaseAdmin
    .from("staff")
    .select(
      "id, name, photo_url, photo_pos_x, photo_pos_y, photo_zoom, job_title, bio",
    )
    .eq("id", id)
    .eq("salon_id", ctx.salon_id)
    .maybeSingle();

  if (!staff) {
    return (
      <main className="page">
        <p className="muted center-text">
          スタッフが見つかりませんでした。
          <br />
          <Link href="/manager/staff" className="text-link">
            スタッフ管理に戻る
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="page page-top">
      <div className="container stack animate-in">
        <header className="stack-sm">
          <Eyebrow className="eyebrow-mint">Edit staff</Eyebrow>
          <h1 className="headline">{staff.name} ・ プロフィール編集</h1>
        </header>

        {saved && (
          <div className="notice notice-success">プロフィールを更新しました。</div>
        )}
        {error && (
          <div className="notice notice-error">
            {ERROR_MESSAGE[error] ?? "エラーが発生しました。"}
          </div>
        )}

        <Card>
          <StaffEditForm
            staffId={staff.id}
            initialPhotoUrl={staff.photo_url ?? null}
            initialPhotoX={staff.photo_pos_x ?? 0}
            initialPhotoY={staff.photo_pos_y ?? 0}
            initialPhotoZoom={staff.photo_zoom ?? 1}
            initialJobTitle={staff.job_title ?? ""}
            initialBio={staff.bio ?? ""}
          />
        </Card>

        <Link href="/manager/staff" className="btn btn-quiet btn-block">
          スタッフ管理へ戻る
        </Link>
      </div>
    </main>
  );
}
