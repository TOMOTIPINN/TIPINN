"use client";

import { useState, useTransition } from "react";

/**
 * 店長Inbox の声リスト（クライアント）。各行の可視性トグル（全員に共有 / 店長控え）を持つ。
 * 楽観更新 → POST /api/manager/visibility（失敗時はロールバック）。
 * 視覚は globals.css のトークンのみ（インラインstyle禁止・§8）。¥は受け取らない・表示しない。
 */
export type InboxRow = {
  id: string;
  emoji: string;
  staffName: string;
  customerName: string;
  time: string;
  body: string;
  visibility: "all" | "manager";
};

export default function InboxList({ rows }: { rows: InboxRow[] }) {
  const [state, setState] = useState<Record<string, "all" | "manager">>(
    () => Object.fromEntries(rows.map((r) => [r.id, r.visibility])),
  );
  const [, startTransition] = useTransition();

  function setVisibility(id: string, next: "all" | "manager") {
    const prev = state[id];
    if (prev === next) return;
    setState((s) => ({ ...s, [id]: next })); // 楽観更新
    startTransition(async () => {
      try {
        const res = await fetch("/api/manager/visibility", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reviewId: id, visibility: next }),
        });
        if (!res.ok) throw new Error("failed");
      } catch {
        setState((s) => ({ ...s, [id]: prev })); // ロールバック
      }
    });
  }

  return (
    <div>
      {rows.map((r) => {
        const vis = state[r.id];
        return (
          <div key={r.id} className="inbox-row">
            <div className="inbox-meta">
              <span className="inbox-emoji" aria-hidden="true">
                {r.emoji}
              </span>
              <span className="inbox-staff">{r.staffName}</span>
              <span className="inbox-customer">{r.customerName}様</span>
              <span className="inbox-time">{r.time}</span>
            </div>
            <p className="inbox-body">「{r.body}」</p>
            <div
              className="seg"
              role="group"
              aria-label="この声の可視性"
            >
              <button
                type="button"
                className={`seg-btn${vis === "all" ? " is-active" : ""}`}
                aria-pressed={vis === "all"}
                onClick={() => setVisibility(r.id, "all")}
              >
                全員に共有
              </button>
              <button
                type="button"
                className={`seg-btn${vis === "manager" ? " is-active" : ""}`}
                aria-pressed={vis === "manager"}
                onClick={() => setVisibility(r.id, "manager")}
              >
                店長控え
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
