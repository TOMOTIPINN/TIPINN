"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 表示名フォーム（/onboarding/name・client）。
 *
 * ★なぜ client component にするか★
 *   送信は従来どおり **ネイティブの form POST**（/api/customer/name が 303 リダイレクトを返す）。
 *   ただしネイティブ POST だけだと、押してから次の画面が出るまで何も変わらず「押せたのか」が
 *   分からない（2026-09-24 実機）。そこでフォーム部分だけ切り出し、押した瞬間にボタンを
 *   disabled ＋「送信中…」にする（JoinConsentForm と同じ切り出し方・POST の形式は変えない）。
 *
 * ★入力欄は disabled にしない★
 *   disabled なフォーム部品は HTML 仕様で送信データから脱落し、name が欠落する
 *   （AddStaffForm の 2026-07-12 の事故と同じ）。無効にするのは name 属性の無いボタンだけ。
 *
 * 二重送信: ボタン disabled に加え、onSubmit 冒頭の再入ガード（ref）で2回目の submit を止める。
 *   サーバー側も UPDATE のみ（行は増えない）なので、万一2回届いても名前が二重登録されることはない。
 *
 * 戻る（bfcache）で「送信中…」のまま復元されると押せなくなるため、pageshow で解除する。
 */
export default function NameForm({
  returnTo,
  defaultName,
  isEdit,
  hasError,
}: {
  returnTo: string;
  defaultName: string;
  isEdit: boolean;
  hasError: boolean;
}) {
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    // 再入ガード: 既に送信中なら2回目の submit を止める（ネイティブ送信はそのまま続く）。
    if (submittingRef.current) {
      e.preventDefault();
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
  }

  return (
    <form
      action="/api/customer/name"
      method="post"
      className="stack-md"
      onSubmit={handleSubmit}
    >
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="field-group">
        <label className="field-label" htmlFor="name">
          お名前
        </label>
        <input
          id="name"
          name="name"
          className="field"
          type="text"
          maxLength={50}
          required
          defaultValue={defaultName}
          placeholder="例：山田 はな"
          autoComplete="name"
        />
      </div>
      {hasError && <p className="muted">お名前を入力してください。</p>}
      <button
        type="submit"
        className="btn btn-outline btn-block"
        disabled={submitting}
      >
        {submitting ? "送信中…" : isEdit ? "変更する" : "はじめる"}
      </button>
    </form>
  );
}
