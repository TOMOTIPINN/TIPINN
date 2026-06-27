import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Eyebrow, Card } from "@/components/ui";
import { resolveInvite, inviteReasonMessage } from "@/lib/staff-invite";

/**
 * /staff/join?token=<invite_token>  （認証方式B / [[auth-method-line-b]]）
 * スタッフ招待リンクの受け口。店長が発行したトークンを、本人の LINE ログインに紐付ける。
 *
 * フロー: 未ログイン → returnTo付きで LINE ログインへ（新ID/PWは作らない）。
 *   ログイン済み＆トークン有効 → 「参加する」確認 → POST /api/staff/bind で紐付け。
 * トーン: サロンUI世界（ミント/ink・ゴシック・¥なし）。
 */
const ROLE_LABEL: Record<string, string> = {
  manager: "店長",
  staff: "スタッフ",
};

export default async function StaffJoinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;

  const session = await getSession();
  if (!session) {
    const back = `/staff/join${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    redirect(`/api/auth/line/login?returnTo=${encodeURIComponent(back)}`);
  }

  const result = await resolveInvite(token, session!.line_user_id);

  // 紐付け失敗から戻ってきた場合（error）か、トークン検証 NG の場合はメッセージ表示。
  if (error || !result.ok) {
    const reason = error ?? (result.ok ? "" : result.reason);
    return (
      <main className="page">
        <div className="container stack center-text animate-in">
          <Eyebrow className="eyebrow-mint">Staff invitation</Eyebrow>
          <Card>
            <p className="body text-balance">{inviteReasonMessage(reason)}</p>
          </Card>
        </div>
      </main>
    );
  }

  const { staff } = result;

  return (
    <main className="page">
      <div className="container stack center-text animate-in">
        <Eyebrow className="eyebrow-mint">Staff invitation</Eyebrow>
        <h1 className="headline">スタッフとして参加</h1>
        <Card>
          <div className="stack-md center-text">
            <p className="body text-balance">
              <strong>{staff.salon_name}</strong> の
              {ROLE_LABEL[staff.role] ?? "スタッフ"}として、
              <br />
              このLINEアカウントを紐付けます。
            </p>
            <p className="muted">対象：{staff.name} さん</p>

            <form action="/api/staff/bind" method="post">
              <input type="hidden" name="token" value={token} />
              <button type="submit" className="btn btn-outline btn-block">
                参加する
              </button>
            </form>

            <p className="note-fine">
              新しいIDやパスワードは作りません。いつものLINEログインで参加できます。
            </p>
          </div>
        </Card>
      </div>
    </main>
  );
}
