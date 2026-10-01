"use client";

import { useRef } from "react";

/**
 * 「送信済み」チェックボックス（/admin/invites）。
 * チェックを変えたら即 form を submit して sent_at を更新する（保存ボタンを置かない）。
 * JS 無効環境ではチェックしても送信されないが、運営者専用画面なので許容する。
 *
 * `action` は送り先。既定値はサロン招待の `/api/admin/invites/sent`（従来どおり）。
 * オーナー招待（/admin/owner-invites・§21 5d）は `/api/admin/owner-invites/sent` を渡す。
 */
export default function SentToggle({
  id,
  checked,
  action = "/api/admin/invites/sent",
}: {
  id: string;
  checked: boolean;
  action?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={action}
      method="post"
      className="admin-sent"
    >
      <input type="hidden" name="id" value={id} />
      {/* チェックを外したときも値を送る必要があるため、hidden で 0 を置く。
          チェック時は hidden の 0 と checkbox の 1 の**両方**が同名で送られる（後勝ちにはならない）。
          受け取る側（/api/admin/invites/sent・/api/admin/owner-invites/sent）は
          form.getAll("sent") に "1" が含まれるかで判定する（form.get は最初の 0 を返すため使わない）。 */}
      <input type="hidden" name="sent" value="0" />
      <label className="admin-sent-label">
        <input
          type="checkbox"
          name="sent"
          value="1"
          defaultChecked={checked}
          onChange={() => formRef.current?.requestSubmit()}
        />
        <span>送信済</span>
      </label>
    </form>
  );
}
