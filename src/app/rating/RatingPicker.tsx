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
 *
 * 表示の告知（§13 ステップ4）: **ティア選択画面**で「お名前とスタンプの種類が、担当スタッフと
 *   サロンに表示されます。」を出す。スタッフ本人宛ての感想詳細（/staff/received/[reviewId]）に
 *   顧客の表示名とティアが出るため、**金額を選ぶ前に**伝える（説明箇所をここ1か所に固定する）。
 *   確認ステップには置かない（あそこは購入内容と年齢確認に絞る）。
 *
 * 年齢確認: 未成年には有料スタンプを販売しない（法務確定）。確認ステップで「私は18歳以上です」を
 *   チェックさせ、未チェックの間は支払いボタンを押せない。
 *   ★状態は保存しない★ tier を選ぶ／選び直すたびに未チェックへ戻す。決済キャンセルで戻る経路は
 *   フルページ遷移（cancel_url）なのでコンポーネントごと再マウントされ、確実に未チェックから始まる。
 *   未チェックでボタンが押せないのは **UI の補助にすぎない**。真の検証はサーバー側
 *   （/api/checkout が明示的な true 以外を 400 adult_confirmation_required で弾く）。
 */
export default function RatingPicker({
  salonId,
  staffId,
  salonName,
  staffName,
  reviewed,
  reviewId,
}: {
  salonId: string;
  staffId: string;
  salonName: string;
  staffName: string;
  // 感想送信済みか。決済キャンセルで rating に戻った際も「感想だけ送る」を出さないため
  // checkout に引き継ぎ、cancel_url に reviewed を維持させる（課金ロジックには不使用）。
  reviewed: boolean;
  // どの感想への評価か（§13 ステップ4）。checkout へ中継するだけで、ここでは検証しない。
  // 購入可否の判定は /api/checkout に1か所だけ置く（ステップ5）。
  reviewId?: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [adult, setAdult] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const tier = selected ? getTier(selected) : null;

  async function purchase() {
    if (!tier || pending || !adult) return;
    setPending(true);
    setError("");
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salonId,
          staffId,
          tier: tier.tier,
          reviewed,
          // どの感想への評価か。値があるときだけ送る（無い場合は checkout 側で
          // metadata.review_id が付かない＝従来どおり null で記録される）。
          ...(reviewId ? { reviewId } : {}),
          // 年齢確認の申告。サーバー側でも必ず検証される（ここを外しても通らない）。
          adult_confirmed: adult,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data?.error ?? "failed");
      // Stripe Checkout（連結アカウント上）へ
      window.location.href = data.url;
    } catch (err) {
      // !res.ok のとき throw new Error(data.error) 済＝ここに API の error コードが載る
      //（ReviewForm の no_visit_today と同じ作法）。
      // ★review_required と invalid_review は区別しない★
      //   サーバー側が「存在しない」と「他人のもの」を同じコードに畳んでいる意図
      //   （reviewId の総当たりで実在を判別させない）を、UI でも崩さないため。
      //   どちらも案内は同じ「正しい入口から入り直してください」になる。
      // それ以外（汎用エラー・ネットワーク断・JSON 破損）は従来どおりの文言。
      const code = err instanceof Error ? err.message : "";
      setError(
        code === "already_purchased"
          ? "この感想には、すでに評価スタンプをお送りいただいています。"
          : code === "review_required" || code === "invalid_review"
            ? "評価スタンプは、感想を送ったあとの画面からお送りいただけます。"
            : code === "adult_confirmation_required"
              ? "年齢の確認にチェックを入れてください。"
              : "購入手続きを開始できませんでした。時間をおいてお試しください。",
      );
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

        {/* 年齢確認（法務確定・未成年には販売しない）。金額表示と支払いボタンの間に置く。
            マークアップは共通クラス .field-check（globals.css）。赤は使わない（§12）。 */}
        <label className="field-check" htmlFor="adult_confirmed">
          <input
            id="adult_confirmed"
            name="adult_confirmed"
            type="checkbox"
            checked={adult}
            onChange={(e) => setAdult(e.target.checked)}
            disabled={pending}
          />
          <span>私は18歳以上です</span>
        </label>

        <button
          type="button"
          className="btn btn-mint btn-block"
          disabled={pending || !adult}
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
            setAdult(false); // 選び直したら年齢確認もやり直す（状態を持ち越さない）。
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
            onClick={() => {
              setSelected(t.tier);
              // 確認ステップに入るたび未チェックから始める（前回の確認を持ち越さない）。
              setAdult(false);
            }}
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

      {/* 表示の告知（§13 ステップ4）。ティアを選ぶ**前**に置く＝金額を決める手前で伝える。
          ここにあった「サロンへの評価スタンプ購入です…」は削除した。確認ステップ新設
          （c77e25d）以降は同じ文が .confirm-note にもあり重複していたため。原則5 の説明も、
          特商法・審査対応の4項目（金額・税込表示・返品不可・特商法リンク）も確認ステップ側にある。 */}
      <p className="muted center-text">
        お名前とスタンプの種類が、担当スタッフとサロンに表示されます。
      </p>
    </div>
  );
}
