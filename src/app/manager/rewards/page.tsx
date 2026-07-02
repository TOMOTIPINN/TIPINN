import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSession } from "@/lib/session";
import { getStaffContext } from "@/lib/staff-session";
import {
  getSalonRewards,
  REWARD_TYPE,
  REWARD_TYPE_LABEL,
  MAX_REWARDS,
} from "@/lib/rewards";
import { Eyebrow, Card } from "@/components/ui";
import SalonNav from "@/components/SalonNav";

/**
 * A3 特典設定（/manager/rewards・サロンUI世界 / [[auth-method-line-b]]）。
 * 店長がVIP特典（貯まるスタンプのサイクル到達でセット付与）を最大2件まで登録・編集・削除する。
 *
 * 認可: 未ログイン→LINEログイン（returnTo）／非manager→閲覧不可。salon は ctx.salon_id にスコープ。
 * 特典の「型」reward_type は3値（割引/サービス/優先）。発動個数は3固定でサーバー管理（店長は触らない）。
 * 金額/割引率は持たない・出さない（換金性排除・CLAUDE.md §2）。トーン: ミント/ink・¥なし・インラインstyle禁止。
 */
const TITLE_MAX = 60;

export default async function ManagerRewardsPage({
  searchParams,
}: {
  searchParams: Promise<{
    created?: string;
    updated?: string;
    deleted?: string;
    error?: string;
  }>;
}) {
  const { created, updated, deleted, error } = await searchParams;

  const session = await getSession();
  if (!session) {
    redirect(
      `/api/auth/line/login?returnTo=${encodeURIComponent("/manager/rewards")}`,
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

  const [{ data: salon }, rewards] = await Promise.all([
    supabaseAdmin.from("salons").select("name").eq("id", ctx.salon_id).single(),
    getSalonRewards(ctx.salon_id),
  ]);

  const atLimit = rewards.length >= MAX_REWARDS;

  return (
    <main className="page page-top">
      <div className="container stack animate-in">
        <SalonNav />
        <header className="stack-sm">
          <Eyebrow className="eyebrow-mint">VIP perks</Eyebrow>
          <h1 className="headline">{salon?.name ?? "サロン"} ・ 特典設定</h1>
          <p className="muted">
            貯まるスタンプが1サイクル貯まったお客様に、登録した特典がまとめて届きます（最大
            {MAX_REWARDS}つ）。
          </p>
        </header>

        {(created || updated || deleted) && (
          <div className="notice notice-success">
            {created
              ? "特典を追加しました。"
              : updated
                ? "特典を更新しました。"
                : "特典を削除しました。"}
          </div>
        )}
        {error === "limit" && (
          <div className="notice notice-error">
            特典は最大{MAX_REWARDS}つまでです。追加するには、どれかを削除してください。
          </div>
        )}

        {/* 新規追加フォーム。上限に達していたら出さず案内に差し替え。 */}
        {atLimit ? (
          <Card>
            <p className="muted center-text">
              特典は最大{MAX_REWARDS}つまで登録できます。変更するには下の特典を編集・削除してください。
            </p>
          </Card>
        ) : (
          <Card>
            <form action="/api/manager/rewards" method="post" className="stack-md">
              <Eyebrow className="eyebrow-mint">Add a perk</Eyebrow>
              <div className="field-group">
                <label className="field-label" htmlFor="reward_type">
                  特典の種類
                </label>
                <select
                  id="reward_type"
                  name="reward_type"
                  className="field"
                  defaultValue="service"
                  required
                >
                  {REWARD_TYPE.map((type) => (
                    <option key={type} value={type}>
                      {REWARD_TYPE_LABEL[type]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="title">
                  特典の内容
                </label>
                <input
                  id="title"
                  name="title"
                  className="field"
                  type="text"
                  maxLength={TITLE_MAX}
                  required
                  placeholder="例：ご褒美SPA10分"
                />
              </div>
              <button type="submit" className="btn btn-outline btn-block">
                特典を追加
              </button>
            </form>
          </Card>
        )}

        {/* 一覧（編集＝reward_type+title／削除）。 */}
        <section className="stack">
          <Eyebrow className="eyebrow-mint">
            Perks（{rewards.length} / {MAX_REWARDS}）
          </Eyebrow>
          {rewards.length === 0 ? (
            <Card>
              <p className="muted center-text">
                まだ特典がありません。上のフォームから追加してください。
              </p>
            </Card>
          ) : (
            rewards.map((reward) => (
              <Card key={reward.id}>
                <div className="stack-md">
                <form
                  action="/api/manager/rewards/update"
                  method="post"
                  className="stack-md"
                >
                  <input type="hidden" name="id" value={reward.id} />
                  <div className="field-group">
                    <label
                      className="field-label"
                      htmlFor={`reward_type-${reward.id}`}
                    >
                      特典の種類
                    </label>
                    <select
                      id={`reward_type-${reward.id}`}
                      name="reward_type"
                      className="field"
                      defaultValue={reward.reward_type}
                      required
                    >
                      {REWARD_TYPE.map((type) => (
                        <option key={type} value={type}>
                          {REWARD_TYPE_LABEL[type]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group">
                    <label className="field-label" htmlFor={`title-${reward.id}`}>
                      特典の内容
                    </label>
                    <input
                      id={`title-${reward.id}`}
                      name="title"
                      className="field"
                      type="text"
                      maxLength={TITLE_MAX}
                      required
                      defaultValue={reward.title}
                    />
                  </div>
                  <button type="submit" className="btn btn-subtle btn-block">
                    更新する
                  </button>
                </form>

                <form action="/api/manager/rewards/delete" method="post">
                  <input type="hidden" name="id" value={reward.id} />
                  <button type="submit" className="btn btn-quiet btn-block">
                    この特典を削除
                  </button>
                </form>
                </div>
              </Card>
            ))
          )}
        </section>

        <section className="stack-sm">
          <Link href="/manager/visit" className="btn btn-quiet btn-block">
            来店スタンプ設定へ
          </Link>
          <Link href="/manager/staff" className="btn btn-quiet btn-block">
            スタッフ管理へ
          </Link>
        </section>
      </div>
    </main>
  );
}
