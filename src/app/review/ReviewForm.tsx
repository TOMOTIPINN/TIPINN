"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button } from "@/components/ui";
import { LogoCircle } from "@/components/LogoCircle";
import {
  REVIEW_BODY_MIN,
  REVIEW_BODY_MAX,
  REVIEW_RATINGS,
  REVIEW_TAGS,
  SHARE_SCOPES,
  type Rating,
  type ShareScope,
} from "@/lib/review";

type Staff = {
  id: string;
  name: string;
  photo_url: string | null;
  job_title: string | null;
  photo_pos_x: number;
  photo_pos_y: number;
  photo_zoom: number;
};

/**
 * 感想入力フォーム（画面マップ03・§5 デザインシステム準拠）。
 * 評価(絵文字4段階) / 体験タグ(複数可) / 共有範囲 / コメント(15〜300字)。
 * スタッフ一覧は GET /api/staff、送信は POST /api/reviews（service role 経由）。
 * 送信成功で /review/complete へ遷移（インラインで出し直さない・再送ループを作らない）。
 */
export default function ReviewForm({ salonId }: { salonId: string }) {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [staffId, setStaffId] = useState("");
  const [rating, setRating] = useState<Rating | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [shareScope, setShareScope] = useState<ShareScope | null>(null);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // スタッフ一覧を取得（マウント時 / salon変更時）
  useEffect(() => {
    let active = true;
    setStaffLoading(true);
    setError("");
    fetch(`/api/staff?salonId=${encodeURIComponent(salonId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("staff_fetch_failed");
        return res.json();
      })
      .then((data: { staff: Staff[] }) => {
        if (active) setStaff(data.staff);
      })
      .catch(() => {
        if (active)
          setError("スタッフ情報の取得に失敗しました。再読み込みしてください。");
      })
      .finally(() => {
        if (active) setStaffLoading(false);
      });
    return () => {
      active = false;
    };
  }, [salonId]);

  const trimmedLen = body.trim().length;
  const canSubmit =
    !submitting &&
    !!staffId &&
    rating !== null &&
    shareScope !== null &&
    trimmedLen >= REVIEW_BODY_MIN &&
    trimmedLen <= REVIEW_BODY_MAX;

  function toggleTag(tag: string) {
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salonId,
          staffId,
          body: body.trim(),
          rating,
          tags,
          shareScope,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "server_error");

      // 完了画面へ遷移（フォームには戻さない）。
      const awarded = data.stampAwarded ? "1" : "0";
      router.push(
        `/review/complete?salon=${encodeURIComponent(salonId)}&staff=${encodeURIComponent(staffId)}&awarded=${awarded}`,
      );
    } catch {
      setError("送信に失敗しました。時間をおいて再度お試しください。");
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="stack">
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}

        {/* スタッフ（写真カードから選択。選択値・送信ロジックは従来どおり staffId） */}
        <fieldset className="field-group">
          <legend className="field-label">どなたに</legend>
          {staffLoading ? (
            <p className="muted">読み込み中…</p>
          ) : (
            <div className="staff-pick" role="radiogroup" aria-label="スタッフ">
              {staff.map((s) => {
                const active = staffId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`staff-pick-card${active ? " is-active" : ""}`}
                    onClick={() => setStaffId(s.id)}
                    disabled={submitting}
                  >
                    <span className="staff-photo" aria-hidden="true">
                      <LogoCircle
                        logoUrl={s.photo_url}
                        x={s.photo_pos_x}
                        y={s.photo_pos_y}
                        zoom={s.photo_zoom}
                        fallback={s.name.slice(0, 3)}
                      />
                    </span>
                    <span className="staff-pick-name">{s.name}</span>
                    {s.job_title && (
                      <span className="staff-pick-jobtitle">{s.job_title}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </fieldset>

        {/* 評価（絵文字4段階） */}
        <fieldset className="field-group">
          <legend className="field-label">今日はいかがでしたか？</legend>
          <div className="rating-row" role="radiogroup" aria-label="評価">
            {REVIEW_RATINGS.map((r) => (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={rating === r.value}
                className={`rating-item${rating === r.value ? " is-active" : ""}`}
                onClick={() => setRating(r.value)}
                disabled={submitting}
              >
                <span className="rating-emoji" aria-hidden="true">
                  {r.emoji}
                </span>
                <span className="rating-label">{r.label}</span>
              </button>
            ))}
          </div>
        </fieldset>

        {/* 体験タグ（複数可） */}
        <fieldset className="field-group">
          <legend className="field-label">体験の中で（複数可）</legend>
          <div className="chip-row">
            {REVIEW_TAGS.map((tag) => {
              const active = tags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={active}
                  className={`chip${active ? " is-active" : ""}`}
                  onClick={() => toggleTag(tag)}
                  disabled={submitting}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* コメント */}
        <div className="field-group">
          <label className="field-label" htmlFor="body">
            そのときの気持ちを、ぜひ。
          </label>
          <textarea
            id="body"
            className="field"
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, REVIEW_BODY_MAX))}
            minLength={REVIEW_BODY_MIN}
            maxLength={REVIEW_BODY_MAX}
            disabled={submitting}
            rows={6}
            placeholder="たとえば「マッサージが気持ちよくて寝そうでした」など"
          />
          <span
            className={`field-count${
              trimmedLen >= REVIEW_BODY_MAX ? " is-limit" : ""
            }`}
          >
            {REVIEW_BODY_MIN}文字以上 ／ {trimmedLen} / {REVIEW_BODY_MAX}
          </span>
        </div>

        {/* 共有範囲 */}
        <fieldset className="field-group">
          <legend className="field-label">どこまで共有しますか？</legend>
          <div className="chip-row" role="radiogroup" aria-label="共有範囲">
            {SHARE_SCOPES.map((s) => (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={shareScope === s.value}
                className={`chip${shareScope === s.value ? " is-active" : ""}`}
                onClick={() => setShareScope(s.value)}
                disabled={submitting}
              >
                {s.label}
              </button>
            ))}
          </div>
        </fieldset>

        <Button type="submit" variant="outline" block disabled={!canSubmit}>
          {submitting ? "送信中…" : "感想を送る"}
        </Button>
        <p className="muted center-text">
          感想を送るとスタンプ +1（購入は不要・1日1個）
        </p>
      </form>
    </Card>
  );
}
