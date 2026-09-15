"use client";

import { useState } from "react";

/**
 * 招待受諾フォーム（/staff/join・本人による公開同意 / 0045）。
 *
 * ★なぜ client component にするか★
 *   page.tsx は Server Component で、受諾は **ネイティブの form POST**（/api/staff/bind が
 *   303 リダイレクトを返すため、fetch にすると遷移を自前で組み直すことになる）。
 *   その形のまま「チェックするまでボタンを押せない」を実現するには checked の state が要る。
 *   そこでフォーム部分だけをこのコンポーネントに切り出し、**POST の形式は従来どおり**にする。
 *
 * ★同意は本人が行う（店長の申告ではない）★
 *   店長には本人に代わって許諾する権限がないため、店長の申告は許諾にならない
 *   （弁護士見解・docs/40_decisions.md §10）。同意はこの画面＝本人の LINE ログイン下で取る。
 *
 * 未チェックでボタンが押せないのは **UI の補助にすぎない**。真の検証はサーバー側
 *   （/api/staff/bind が明示的な true 以外を 400 consent_required で弾く）。
 */
export default function JoinConsentForm({ token }: { token: string }) {
  const [consent, setConsent] = useState(false);

  return (
    <form action="/api/staff/bind" method="post" className="stack-md">
      <input type="hidden" name="token" value={token} />

      {/* マークアップは既存の manager/visit/page.tsx と同じ field-group + field-label 構成
          （新しい CSS クラスを増やさない）。checked のときだけ "on" が送られる。 */}
      <div className="field-group">
        <label className="field-label" htmlFor="publish_consent">
          私の氏名・肩書・紹介文・写真（登録されている場合）が、echo
          を利用するお客様に表示されることに同意します
        </label>
        <input
          id="publish_consent"
          name="publish_consent"
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
      </div>

      <button
        type="submit"
        className="btn btn-outline btn-block"
        disabled={!consent}
      >
        参加する
      </button>
    </form>
  );
}
