import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";
import { getVisitContext } from "@/lib/visit-context";
import { resolveSalonRole } from "@/lib/display-role";
import { Eyebrow } from "@/components/ui";
import RoleBar from "@/components/RoleBar";
import VisitScanner from "./VisitScanner";

/**
 * 来店受付（/staff/visit・サロンUI世界 / [[auth-method-line-b]]）。
 * お客様のQRを読み取り、その場で来店を記録する店頭画面。2経路で開ける:
 *   ・スタッフ経路（温存）: LINEログイン中の staff/manager（role 問わず）。
 *   ・端末経路（追加）    : 有効な device_token cookie を持つ据え置き端末（LINE無し・匿名記録）。
 *
 * 認可: getVisitContext() で解決。あれば scanner を描画（端末経路のときだけ「受付端末」バナー）。
 *   無ければ:
 *     ・?device=error（登録URLが無効）→ エラーカード表示（キオスクを LINE ログインに飛ばさない）。
 *     ・それ以外は既存挙動: 未ログイン→returnTo付きLINEログイン／ログイン済み未紐付け→参加案内。
 * 読み取り・記録は client(VisitScanner)＋API /api/staff/visit が担う（salon スコープはサーバー側）。
 */
export default async function StaffVisitPage({
  searchParams,
}: {
  searchParams: Promise<{ device?: string }>;
}) {
  const { device } = await searchParams;

  const vctx = await getVisitContext();

  if (vctx) {
    // ロールバーはスタッフ経路のみ。端末（匿名キオスク）経路は「役割」を持たないので出さない。
    const staffCtx =
      vctx.source === "staff" ? await getStaffContext() : null;
    const displayRole = staffCtx ? await resolveSalonRole(staffCtx) : null;

    return (
      <main className="page page-top" data-role={displayRole ?? undefined}>
        <div className="container stack animate-in">
          {displayRole && <RoleBar role={displayRole} />}
          <header className="stack-sm">
            <Eyebrow className="eyebrow-mint">Check-in</Eyebrow>
            <h1 className="headline">来店受付</h1>
            <p className="muted">
              お客様のマイページQRを読み取って、ご来店を記録します。
            </p>
            {vctx.source === "device" && (
              <p className="muted">この端末は受付端末として登録されています。</p>
            )}
          </header>

          <VisitScanner />
        </div>
      </main>
    );
  }

  // 端末登録URLが無効だった場合（Route Handler からの誘導）。ログインへは飛ばさない。
  if (device === "error") {
    return (
      <main className="page">
        <p className="muted center-text">
          受付端末の登録に失敗しました。
          <br />
          店長の管理画面（受付端末）から、最新のQRで登録し直してください。
        </p>
      </main>
    );
  }

  // ここから既存挙動: スタッフ経路の未認証フォールバック。
  const session = await getSession();
  if (!session) {
    redirect(
      `/api/auth/line/login?returnTo=${encodeURIComponent("/staff/visit")}`,
    );
  }

  return (
    <main className="page">
      <p className="muted center-text">
        このアカウントはスタッフとして登録されていません。
        <br />
        店長から届いた招待リンクから参加してください。
      </p>
    </main>
  );
}
