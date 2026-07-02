"use client";

import { useState } from "react";

/**
 * チェックイン（画面10・マイページ／白世界）。
 *
 * お客様が「見せる用」の自分のQRを、同じ画面内でアコーディオン展開する補助動線。
 * QR自体はサーバー側で生成済み（qrDataUrl を prop で受け取るだけ＝外部送信なし・原則7）。
 *
 * スコープ: これは提示専用。店側の読み取り・来店加算・LINE通知は今回対象外。
 * §8 インラインstyle無し（.checkin* は globals.css）。§12 装飾ミントは一切使わない
 *   （トグルは控えめな .btn-outline）。
 */
export default function CheckInCard({ qrDataUrl }: { qrDataUrl: string }) {
  const [open, setOpen] = useState(false);

  return (
    <section className="checkin">
      <button
        type="button"
        className="btn btn-outline btn-block checkin-toggle"
        aria-expanded={open}
        aria-controls="checkin-panel"
        onClick={() => setOpen((v) => !v)}
      >
        チェックイン
      </button>

      {open && (
        <div id="checkin-panel" className="checkin-panel">
          <img
            className="checkin-qr"
            src={qrDataUrl}
            alt="チェックイン用QRコード"
            width={240}
            height={240}
          />
          <p className="muted checkin-hint">来店時にスタッフにご提示ください</p>
        </div>
      )}
    </section>
  );
}
