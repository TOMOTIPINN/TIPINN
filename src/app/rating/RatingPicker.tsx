"use client";

import { useState } from "react";
import { RATING_TIERS } from "@/lib/rating-tiers";

/**
 * tier 選択 → /api/checkout で Stripe Checkout Session を作成 → Stripe へ遷移（4.1）。
 * 価格は表示用。実際の課金額はサーバーの tier 定義のみが決める（原則8）。
 * customer_id はサーバーのセッションから取得されるため、ここでは一切送らない（原則7）。
 */
export default function RatingPicker({
  salonId,
  staffId,
}: {
  salonId: string;
  staffId: string;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function choose(tier: string) {
    if (pending) return;
    setPending(tier);
    setError("");
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salonId, staffId, tier }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data?.error ?? "failed");
      // Stripe Checkout（連結アカウント上）へ
      window.location.href = data.url;
    } catch {
      setError("購入手続きを開始できませんでした。時間をおいてお試しください。");
      setPending(null);
    }
  }

  return (
    <div className="stack-sm">
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}

      <div className="tier-list">
        {RATING_TIERS.map((t) => (
          <button
            key={t.tier}
            type="button"
            className="tier-row"
            disabled={pending !== null}
            onClick={() => choose(t.tier)}
          >
            <span className="tier-emoji" aria-hidden="true">
              {t.emoji}
            </span>
            <span className="tier-label">{t.label}</span>
            <span className="tier-amount">
              {pending === t.tier ? "処理中…" : `¥${t.amount.toLocaleString()}`}
            </span>
          </button>
        ))}
      </div>

      <p className="muted center-text">
        サロンへの評価スタンプ購入です。スタッフへ直接お金をお渡しするものではありません。
      </p>
    </div>
  );
}
