import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";
import { Eyebrow, Card } from "@/components/ui";
import SalonNav from "@/components/SalonNav";
import { resolveSalonRole } from "@/lib/display-role";
import { ImageAdjuster } from "@/components/ImageAdjuster";

/**
 * A6 店舗プロフィール（/manager/profile・サロンUI世界 / [[auth-method-line-b]]）。
 * 店長がサロンのロゴ画像をアップロードする。ロゴはお客様のマイページ（/mypage）の
 * スタンプ円などに反映される（表示側は既存の logo_url を読むだけ）。
 *
 * 認可: 未ログイン→LINEログイン（returnTo）／非manager→閲覧不可。salon は ctx.salon_id にスコープ。
 * アップロードは /api/manager/profile（service_role・サーバー側）。クライアント直叩きしない（§3・§8）。
 * トーン: ミント/ink・ゴシック・¥なし。インラインstyle禁止（globals.css のトークンのみ）。
 */
const ERROR_MESSAGE: Record<string, string> = {
  missing: "画像ファイルを選択してください。",
  type: "対応していない形式です。PNG / JPEG / WebP を選んでください。",
  size: "ファイルが大きすぎます（上限2MB）。",
  upload: "アップロードに失敗しました。時間をおいて再度お試しください。",
  save: "保存に失敗しました。時間をおいて再度お試しください。",
};

export default async function ManagerProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;

  const session = await getSession();
  if (!session) {
    redirect(
      `/api/auth/line/login?returnTo=${encodeURIComponent("/manager/profile")}`,
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

  const { data: salon } = await supabaseAdmin
    .from("salons")
    .select("name, logo_url, logo_pos_x, logo_pos_y, logo_zoom")
    .eq("id", ctx.salon_id)
    .single();

  const name = salon?.name ?? "サロン";
  const logoUrl = salon?.logo_url ?? null;

  const displayRole = await resolveSalonRole(ctx);

  return (
    <main className="page page-top" data-role={displayRole}>
      <div className="container stack animate-in">
        <SalonNav role={displayRole} />
        <header className="stack-sm">
          <Eyebrow className="eyebrow-mint">Salon profile</Eyebrow>
          <h1 className="headline">{name} ・ 店舗プロフィール</h1>
          <p className="muted">
            サロンのロゴを設定します。ロゴはお客様のマイページやスタンプに表示されます。
          </p>
        </header>

        {saved && (
          <div className="notice notice-success">ロゴを更新しました。</div>
        )}
        {error && (
          <div className="notice notice-error">
            {ERROR_MESSAGE[error] ?? "エラーが発生しました。"}
          </div>
        )}

        <Card>
          <form
            action="/api/manager/profile"
            method="post"
            encType="multipart/form-data"
            className="stack-md"
          >
            <Eyebrow className="eyebrow-mint">Logo</Eyebrow>

            <ImageAdjuster
              initialImageUrl={logoUrl}
              initialX={salon?.logo_pos_x ?? 0}
              initialY={salon?.logo_pos_y ?? 0}
              initialZoom={salon?.logo_zoom ?? 1}
              fileFieldName="logo"
              posXFieldName="logo_pos_x"
              posYFieldName="logo_pos_y"
              zoomFieldName="logo_zoom"
              fileLabel="ロゴ画像を選ぶ"
              emptyLabel={
                <>
                  まだロゴが
                  <br />
                  設定されていません
                </>
              }
            />

            <button type="submit" className="btn btn-outline btn-block">
              ロゴを保存
            </button>
          </form>
        </Card>

        <Link href="/manager/staff" className="btn btn-quiet btn-block">
          スタッフ管理へ
        </Link>
      </div>
    </main>
  );
}
