"use client";

import { useState } from "react";
import { RATING_TIERS, getTier } from "@/lib/rating-tiers";

/**
 * tier 選択 → 確認 → /api/checkout で Stripe Checkout Session を作成 → Stripe へ遷移（4.1）。
 * 価格は表示用。実際の課金額はサーバーの tier 定義のみが決める（原則8）。
 * customer_id はサーバーのセッションから取得されるため、ここでは一切送らない（原則7）。
 *
 * 確認ステップ: ワンタップで Checkout へ飛ばさず、購入内容を提示してから確定させる。
 * 特商法の表示義務および決済代行会社の審査要件（買い物カート画面）に対応する。
 * カスタマーUIのためミントは主CTA（.btn-mint）のみ。カードの装飾は無彩色で組む（§5）。
 */
export default function RatingPicker({
  salonId,
  staffId,
  salonName,
  staffName,
  reviewed,
}: {
  salonId: string;
  staffId: string;
  salonName: string;
  staffName: string;
  // 感想送信済みか。決済キャンセルで rating に戻った際も「感想だけ送る」を出さないため
  // checkout に引き継ぎ、cancel_url に reviewed を維持させる（課金ロジックには不使用）。
  reviewed: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const tier = selected ? getTier(selected) : null;

  async function purchase() {
    if (!tier || pending) return;
    setPending(true);
    setError("");
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salonId, staffId, tier: tier.tier, reviewed }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data?.error ?? "failed");
      // Stripe Checkout（連結アカウント上）へ
      window.location.href = data.url;
    } catch {
      setError("購入手続きを開始できませんでした。時間をおいてお試しください。");
      setPending(false);
    }
  }

  /* ── 確認ステップ ───────────────────────────── */
  if (tier) {
    const yen = `¥${tier.amount.toLocaleString()}`;

    return (
      <div className="stack-sm">
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}

        <div className="confirm-card">
          <p className="eyebrow">ご購入内容</p>

          <div className="confirm-item">
            <span className="tier-emoji" aria-hidden="true">
              {tier.emoji}
            </span>
            <span className="tier-label">{tier.label}</span>
            <span className="tier-amount">{yen}</span>
          </div>

          <dl className="confirm-meta">
            <div className="confirm-row">
              <dt>お支払い金額</dt>
              <dd>{yen}（税込）</dd>
            </div>
          </dl>

          <p className="confirm-note">
            サロンへの評価スタンプ購入です。スタッフへ直接お金をお渡しするものではありません。
            デジタル商品のため、決済完了後の返品・キャンセルはできません。
          </p>
        </div>

        <button
          type="button"
          className="btn btn-mint btn-block"
          disabled={pending}
          onClick={purchase}
        >
          {pending ? "処理中…" : `${yen} を支払う`}
        </button>

        <button
          type="button"
          className="btn btn-quiet btn-block"
          disabled={pending}
          onClick={() => {
            setSelected(null);
            setError("");
          }}
        >
          選び直す
        </button>

        <p className="muted center-text">
          <a href="/company" target="_blank" rel="noreferrer">
            特定商取引法に基づく表記
          </a>
        </p>
      </div>
    );
  }

  /* ── 選択ステップ ───────────────────────────── */
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
            onClick={() => setSelected(t.tier)}
          >
            <span className="tier-emoji" aria-hidden="true">
              {t.emoji}
            </span>
            <span className="tier-label">{t.label}</span>
            <span className="tier-amount">
              {`¥${t.amount.toLocaleString()}`}
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
