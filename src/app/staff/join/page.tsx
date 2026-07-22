import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { resolveStaffByLineUserId } from "@/lib/staff-session";
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

  // 既に登録済みのスタッフが古い招待リンクを誤タップしたケース（line_taken / not_found / already_used に
  // 散らばる）を、トークン検証より前に肯定的な案内で受け止める。判定は resolveStaffByLineUserId
  // （在籍 staff の単一ソース・退職者は null）を流用。登録済みなら resolveInvite は ok:true にならない
  // （自分のトークンは bind 時に null 消費済み／他行のトークンは line_taken でNG）ため、通常の新規参加
  // フロー・トークンのセキュリティ挙動には一切影響しない。文言は在籍サロンを問わず統一（アカウントの
  // 現状のみを述べ「別サロンに参加した」とは言わない）。
  const existingStaff = await resolveStaffByLineUserId(session!.line_user_id);
  if (existingStaff) {
    return (
      <main className="page">
        <div className="container stack center-text animate-in">
          <Eyebrow className="eyebrow-mint">Staff invitation</Eyebrow>
          <h1 className="headline">スタッフ登録は完了しています</h1>
          <Card>
            <div className="stack-md center-text">
              <p className="body text-balance">
                このLINEアカウントは、すでにスタッフ登録が完了しています。
                <br />
                あらためて招待を受け取る必要はありません。
              </p>

              <Link href="/staff" className="btn btn-outline btn-block">
                スタッフページを開く
              </Link>

              <p className="note-fine">
                ホーム画面に追加しておくと、次回からすぐに開けます。
              </p>
            </div>
          </Card>
        </div>
      </main>
    );
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
