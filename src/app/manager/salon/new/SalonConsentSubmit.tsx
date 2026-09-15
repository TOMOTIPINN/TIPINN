"use client";

import { useState } from "react";

/**
 * サロン作成フォームの公開同意チェック＋送信ボタン（/manager/salon/new・0045）。
 *
 * ★なぜこの2つだけを client に切り出すか★
 *   page.tsx は Server Component で、フォームは **ネイティブの multipart POST**
 *   （ロゴの File を送るため）。route 側は 303 リダイレクトで返す。
 *   「チェックするまで送信できない」には checked の state が要るが、フォーム全体を
 *   client 化すると招待コード・店名・ロゴ・通知遅延の4フィールドすべてを巻き込む。
 *   checkbox と button は同じ <form> の中にあれば POST に載るので、**この2つだけ**を
 *   切り出す＝既存フィールドと POST の形式は1文字も変えない。
 *
 * ★オーナーも顧客に表示される★
 *   /api/staff の絞り込みは role を見ないため、オーナー（role=manager）の氏名も
 *   スタッフと同じように顧客に表示される。この経路は**本人が自分で操作している**ので、
 *   同意は本人から直接取れる（店長の申告では許諾にならない・docs/40_decisions.md §10）。
 *
 * 未チェックでボタンが押せないのは **UI の補助にすぎない**。真の検証はサーバー側
 *   （/api/manager/salon/new が明示的な true 以外を error=consent で弾く）。
 */
export default function SalonConsentSubmit() {
  const [consent, setConsent] = useState(false);

  return (
    <>
      {/* マークアップは共通クラス .field-check（globals.css）。
          checked のときだけ "on" が送られる。 */}
      <label className="field-check" htmlFor="publish_consent">
        <input
          id="publish_consent"
          name="publish_consent"
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>
          私はこのサロンのスタッフとして echo
          に登録され、私の氏名・肩書・紹介文・写真（登録されている場合）がお客様に表示されることに同意します
        </span>
      </label>

      <button
        type="submit"
        className="btn btn-outline btn-block"
        disabled={!consent}
      >
        登録して来店QRを発行
      </button>
    </>
  );
}
