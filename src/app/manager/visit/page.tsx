import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";
import { Eyebrow, Card } from "@/components/ui";
import SalonNav from "@/components/SalonNav";
import { resolveSalonRole } from "@/lib/display-role";

/**
 * 来店スタンプ設定（/manager/visit・サロンUI世界 / Phase 7・ブロック4 / [[auth-method-line-b]]）。
 * 店長が来店軸の ON/OFF（visit_axis_enabled）と発動ハードル（visit_cycle_size・10〜20）を設定する。
 *
 * 認可: 未ログイン→LINEログイン（returnTo）／非manager→閲覧不可。salon は ctx.salon_id にスコープ。
 * 来店軸は無料・無決済（rating_purchases に干渉しない）。特典は感想軸と共通の rewards（/manager/rewards）。
 * トーン: サロンUI＝ミント（eyebrow-mint）・¥なし・赤なし・インラインstyle禁止。
 */
const CYCLE_MIN = 10;
const CYCLE_MAX = 20;

type SalonVisit = {
  name: string;
  visit_axis_enabled: boolean;
  visit_cycle_size: number;
};

export default async function ManagerVisitPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;

  const session = await getSession();
  if (!session) {
    redirect(
      `/api/auth/line/login?returnTo=${encodeURIComponent("/manager/visit")}`,
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
    .select("name, visit_axis_enabled, visit_cycle_size")
    .eq("id", ctx.salon_id)
    .single<SalonVisit>();

  const enabled = salon?.visit_axis_enabled === true;
  const cycleSize = salon?.visit_cycle_size ?? 20;

  const displayRole = await resolveSalonRole(ctx);

  return (
    <main className="page page-top" data-role={displayRole}>
      <div className="container stack animate-in">
        <SalonNav role={displayRole} />
        <header className="stack-sm">
          <Eyebrow className="eyebrow-mint">Visit stamps</Eyebrow>
          <h1 className="headline">{salon?.name ?? "サロン"} ・ 来店スタンプ設定</h1>
          <p className="muted">
            ご来店ごとに貯まるスタンプです。設定した回数ごとに、登録済みの特典（最大2つ）が届きます。
          </p>
        </header>

        {saved && (
          <div className="notice notice-success">設定を保存しました。</div>
        )}
        {error === "range" && (
          <div className="notice notice-error">
            ハードルは{CYCLE_MIN}〜{CYCLE_MAX}の数値で入力してください。
          </div>
        )}

        <Card>
          <form action="/api/manager/visit" method="post" className="stack-md">
            <div className="field-group">
              <label className="field-label" htmlFor="visit_axis_enabled">
                来店スタンプを有効にする
              </label>
              <input
                id="visit_axis_enabled"
                name="visit_axis_enabled"
                type="checkbox"
                defaultChecked={enabled}
              />
              <span className="field-help">
                OFFの間もご来店は記録され、ONにすると過去分も反映されます。
              </span>
            </div>

            <div className="field-group">
              <label className="field-label" htmlFor="visit_cycle_size">
                発動ハードル（{CYCLE_MIN}〜{CYCLE_MAX}回）
              </label>
              <input
                id="visit_cycle_size"
                name="visit_cycle_size"
                className="field"
                type="number"
                min={CYCLE_MIN}
                max={CYCLE_MAX}
                step={1}
                required
                defaultValue={cycleSize}
              />
              <span className="field-help">
                この回数ごとに特典が発動します（例：20なら20回・40回…）。
              </span>
            </div>

            <button type="submit" className="btn btn-outline btn-block">
              保存する
            </button>
          </form>
        </Card>

        <section className="stack-sm">
          <Link href="/manager/rewards" className="btn btn-quiet btn-block">
            特典設定へ
          </Link>
          <Link href="/manager/staff" className="btn btn-quiet btn-block">
            スタッフ管理へ
          </Link>
        </section>
      </div>
    </main>
  );
}
