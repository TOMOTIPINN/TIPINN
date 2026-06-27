"use client";

import { useState } from "react";

/**
 * 招待URLのコピー（A1・/manager/staff）。小さな client component。
 * クリックでクリップボードへコピーし、短時間「コピー済み」を表示する。
 * 視覚は globals.css のトークンのみ（インラインstyle禁止・§8）。
 */
export default function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      className="btn btn-subtle"
      onClick={copy}
      aria-live="polite"
    >
      {copied ? "コピーしました" : "URLをコピー"}
    </button>
  );
}
