"use client";

import { useState } from "react";

/**
 * オンボーディング完了画面の来店QR（/manager/salon/new?created=…）。
 * QR画像（dataURL）はサーバー側で生成して渡す（qrcode・外部送信なし・原則7）。
 * この client は「PNGダウンロード」と「URLコピー」だけを担う小さな部品。
 * 視覚は globals.css のトークンのみ（インラインstyle禁止・§8）。
 */
export default function SalonQr({
  qr,
  url,
  fileName,
}: {
  qr: string;
  url: string;
  fileName: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="stack-md center-text">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="qr-img" src={qr} alt="来店受付QRコード" width={200} height={200} />

      <a className="btn btn-outline btn-block" href={qr} download={fileName}>
        QRをPNGで保存
      </a>

      <button
        type="button"
        className="btn btn-subtle btn-block"
        onClick={copy}
        aria-live="polite"
      >
        {copied ? "コピーしました" : "来店URLをコピー"}
      </button>
    </div>
  );
}
