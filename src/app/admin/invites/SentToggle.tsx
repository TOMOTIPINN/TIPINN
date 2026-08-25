"use client";

import { useRef } from "react";

/**
 * 「送信済み」チェックボックス（/admin/invites）。
 * チェックを変えたら即 form を submit して sent_at を更新する（保存ボタンを置かない）。
 * JS 無効環境ではチェックしても送信されないが、運営者専用画面なので許容する。
 */
export default function SentToggle({
  id,
  checked,
}: {
  id: string;
  checked: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action="/api/admin/invites/sent"
      method="post"
      className="admin-sent"
    >
      <input type="hidden" name="id" value={id} />
      {/* チェックを外したときも値を送る必要があるため、hidden で 0 を先に置き、
          checkbox が checked のときだけ後勝ちで 1 を送る（同名の後者が採用される）。 */}
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
