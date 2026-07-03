import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";
import { Eyebrow } from "@/components/ui";
import VisitScanner from "./VisitScanner";

/**
 * 来店受付（/staff・サロンUI世界 / 来店スライス1・LINE無し / [[auth-method-line-b]]）。
 * スタッフ（staff/manager どちらでも）がお客様のQRを読み取り、その場で来店を記録する店頭画面。
 *
 * 認可: /staff ホームと同じインラインガードに準拠（未ログイン→returnTo付きLINEログイン／
 *   スタッフ未紐付け→参加案内）。role は問わない＝一般スタッフも受付できる。新しい認証ロジックは足さない。
 * 読み取り・記録は client(VisitScanner)＋API /api/staff/visit が担う（salon スコープは ctx.salon_id）。
 */
export default async function StaffVisitPage() {
  const session = await getSession();
  if (!session) {
    redirect(
      `/api/auth/line/login?returnTo=${encodeURIComponent("/staff/visit")}`,
    );
  }

  const ctx = await getStaffContext();
  if (!ctx) {
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

  return (
    <main className="page page-top">
      <div className="container stack animate-in">
        <header className="stack-sm">
          <Eyebrow className="eyebrow-mint">Check-in</Eyebrow>
          <h1 className="headline">来店受付</h1>
          <p className="muted">
            お客様のマイページQRを読み取って、ご来店を記録します。
          </p>
        </header>

        <VisitScanner />
      </div>
    </main>
  );
}
