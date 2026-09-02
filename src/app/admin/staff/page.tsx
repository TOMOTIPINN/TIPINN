import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isAdmin } from "@/lib/admin-guard";
import { Eyebrow, Card } from "@/components/ui";

/**
 * スタッフの店舗移動・権限変更（/admin/staff・echo Labs 運営者のみ）。
 *
 * ★非運営者には notFound() ＝ HTTP 404★
 *   /admin/invites・/admin/salons と同じ作法（@/lib/admin-guard・env ADMIN_LINE_USER_IDS だけで判定）。
 *   403 は「このURLは存在する」というオラクルになるため使わない。staff.role は見ない。
 *   導線は張らない（URL直打ち専用）。ナビに出すと運営画面の存在が漏れる。
 *
 * なぜ /manager ではないのか: 店舗移動は経営判断であり、各サロンの店長権限では扱わない。
 *   /manager/* は ctx.salon_id で自店にスコープされる構造なので、横断操作を持ち込むと権限モデルが崩れる。
 *
 * 画面の作り: サロンを1つ選ぶ → そのサロンの**在籍**スタッフを一覧 → 行ごとに
 *   「移動」フォームと「権限」フォームを出す。全サロンの全スタッフを1画面に並べない
 *   ＝行数が増えるほど誤操作が起きるため（運営が触るのは一度に1店）。
 *
 * デモ／テストサロンは除外しない（/admin/salons の EXCLUDED_SALON_IDS は「運営実績の集計」から
 * 外すためのもので、ここは運用操作の画面。テストサロンのスタッフも動かせる必要がある）。
 *
 * トーン: /admin/invites と同じ明るいカードUI。インライン style 禁止・赤なし（docs/30_design.md §2）。
 */
export const dynamic = "force-dynamic";

type SalonRow = { id: string; name: string };

type StaffRow = {
  id: string;
  name: string;
  role: string;
  job_title: string | null;
  line_user_id: string | null;
  created_at: string;
};

const ROLE_LABEL: Record<string, string> = {
  manager: "店長",
  staff: "スタッフ",
};

/** API が返す分類語 → 運営者向けの日本語（/admin/invites の ERROR_MESSAGE と同じ作法）。 */
const ERROR_MESSAGE: Record<string, string> = {
  form: "送信データを読み取れませんでした。",
  id: "対象を特定できませんでした。",
  same_salon: "移動元と移動先が同じサロンです。",
  not_found: "対象のスタッフが見つかりませんでした（退職済み・移動済みの可能性があります）。",
  invalid_role: "権限の指定が不正です。",
  no_change: "現在と同じ権限です。変更はありません。",
  last_manager:
    "このサロンで最後の店長のため実行できません。先に別のスタッフを店長にしてから、もう一度お試しください。",
  conflict:
    "表示していた内容が古くなっています（別の操作が先に反映されました）。画面を開き直してご確認ください。",
  save: "保存に失敗しました。時間をおいて再度お試しください。",
};

const jstDate = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export default async function AdminStaffPage({
  searchParams,
}: {
  searchParams: Promise<{
    salon?: string;
    moved?: string;
    rolechanged?: string;
    error?: string;
  }>;
}) {
  const { salon: selectedId, moved, rolechanged, error } = await searchParams;

  // 非運営者はここで 404。以降の DB アクセスには絶対に到達させない。
  if (!(await isAdmin())) notFound();

  const { data: salonData } = await supabaseAdmin
    .from("salons")
    .select("id, name")
    .order("name", { ascending: true });
  const salons = (salonData ?? []) as SalonRow[];

  // 選択中サロン。クエリが不正／未指定なら未選択（一覧は出さない）。
  const selected = salons.find((s) => s.id === selectedId) ?? null;

  // 在籍のみ（退職者は移動・権限変更の対象外＝API 側も archived_at is null で弾く）。
  let staff: StaffRow[] = [];
  if (selected) {
    const { data } = await supabaseAdmin
      .from("staff")
      .select("id, name, role, job_title, line_user_id, created_at")
      .eq("salon_id", selected.id)
      .is("archived_at", null)
      .order("created_at", { ascending: true });
    staff = (data ?? []) as StaffRow[];
  }

  // 「最後の店長」表示用。API 側の判定（last_manager）と同じ条件を画面でも先に見せる。
  // ★ 認可の正は必ず API 側★ ここはあくまで事前の案内で、画面を信用して弾いてはいない。
  const managerCount = staff.filter((s) => s.role === "manager").length;

  return (
    <main className="page page-top">
      <div className="container container-wide stack animate-in">
        <header className="stack-sm">
          <Eyebrow>Admin</Eyebrow>
          <h1 className="headline">スタッフの店舗移動・権限</h1>
          <p className="muted">
            異動したスタッフを別のサロンへ移します。過去の感想・評価は移動元のサロンに残ります（実績の帰属は変わりません）。
          </p>
        </header>

        {error && (
          <div className="notice notice-error">
            {ERROR_MESSAGE[error] ?? "エラーが発生しました。"}
          </div>
        )}
        {moved && (
          <div className="notice notice-success">
            スタッフを移動しました。権限は「スタッフ」にリセットされています。
          </div>
        )}
        {rolechanged && (
          <div className="notice notice-success">権限を変更しました。</div>
        )}

        {/* サロン選択（GET・素のフォーム。選ぶと ?salon= で開き直す） */}
        <Card>
          <form action="/admin/staff" method="get" className="stack-md">
            <div className="field-group">
              <label className="field-label" htmlFor="salon">
                サロンを選ぶ
              </label>
              <select
                id="salon"
                name="salon"
                className="field"
                defaultValue={selected?.id ?? ""}
                required
              >
                <option value="" disabled>
                  選択してください
                </option>
                {salons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-outline btn-block">
              このサロンのスタッフを表示
            </button>
          </form>
        </Card>

        {!selected ? (
          <p className="muted center-text">
            サロンを選ぶと、在籍スタッフの一覧が表示されます。
          </p>
        ) : staff.length === 0 ? (
          <p className="muted center-text">
            {selected.name} に在籍スタッフはいません。
          </p>
        ) : (
          <section className="stack">
            <Eyebrow>
              {selected.name}（{staff.length}）
            </Eyebrow>

            {staff.map((s) => {
              // このスタッフを動かす／降格させると管理不能になるか（API と同条件の事前案内）。
              const isLastManager = s.role === "manager" && managerCount <= 1;
              const otherSalons = salons.filter((x) => x.id !== selected.id);

              return (
                <Card key={s.id}>
                  <div className="stack-md">
                    <div className="staff-admin-head">
                      <div className="staff-admin-id">
                        <span className="staff-admin-name">{s.name}</span>
                        {s.job_title && (
                          <span className="staff-admin-jobtitle">
                            {s.job_title}
                          </span>
                        )}
                      </div>
                      <span className="role-tag">
                        {ROLE_LABEL[s.role] ?? "スタッフ"}
                      </span>
                      {s.line_user_id ? (
                        <span className="status-pill is-bound">参加済み</span>
                      ) : (
                        <span className="status-pill">未参加</span>
                      )}
                    </div>

                    <p className="note-fine">
                      登録日：{jstDate.format(new Date(s.created_at))}
                    </p>

                    {isLastManager && (
                      <p className="note-fine">
                        このサロンで最後の店長です。移動・降格の前に、別のスタッフを店長にしてください。
                      </p>
                    )}

                    {/* 店舗移動。fromSalonId を送って楽観ロックに使う（0件更新なら conflict）。 */}
                    {otherSalons.length > 0 && (
                      <form
                        action="/api/admin/staff/transfer"
                        method="post"
                        className="stack-sm"
                      >
                        <input type="hidden" name="staffId" value={s.id} />
                        <input
                          type="hidden"
                          name="fromSalonId"
                          value={selected.id}
                        />
                        <div className="field-group">
                          <label
                            className="field-label"
                            htmlFor={`to-${s.id}`}
                          >
                            移動先のサロン
                          </label>
                          <select
                            id={`to-${s.id}`}
                            name="toSalonId"
                            className="field"
                            defaultValue=""
                            required
                          >
                            <option value="" disabled>
                              選択してください
                            </option>
                            {otherSalons.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </select>
                          <span className="field-help">
                            移動すると権限は「スタッフ」にリセットされます。肩書き（{
                              s.job_title || "未設定"
                            }）はそのまま引き継ぎます。
                          </span>
                        </div>
                        <button type="submit" className="btn btn-subtle btn-block">
                          このサロンへ移動する
                        </button>
                      </form>
                    )}

                    {/* 権限変更。現在値を defaultValue に反映（同値送信は API が no_change で弾く）。 */}
                    <form
                      action="/api/admin/staff/role"
                      method="post"
                      className="stack-sm"
                    >
                      <input type="hidden" name="staffId" value={s.id} />
                      <input
                        type="hidden"
                        name="salonId"
                        value={selected.id}
                      />
                      <div className="field-group">
                        <label className="field-label" htmlFor={`role-${s.id}`}>
                          権限
                        </label>
                        <select
                          id={`role-${s.id}`}
                          name="role"
                          className="field"
                          defaultValue={s.role === "manager" ? "manager" : "staff"}
                          required
                        >
                          <option value="staff">スタッフ</option>
                          <option value="manager">店長</option>
                        </select>
                        <span className="field-help">
                          店長は自店の管理画面（/manager）に入れます。肩書き（職種）とは別物です。
                        </span>
                      </div>
                      <button type="submit" className="btn btn-subtle btn-block">
                        権限を変更する
                      </button>
                    </form>
                  </div>
                </Card>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}
