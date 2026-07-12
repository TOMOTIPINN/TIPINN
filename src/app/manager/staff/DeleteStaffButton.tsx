"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogoCircle } from "@/components/LogoCircle";

/**
 * スタッフの物理削除ボタン＋確認モーダル（A1 管理画面・誤登録の重複を消す用）。
 *
 * 棲み分け: 実在スタッフの退職は archive（編集ページ）。ここは実績ゼロのスタッフだけを
 *   hard delete する。削除は取り返しがつかないため guard を厚めにする:
 *   ・「削除」→ モーダルを開いた時点で counts API を都度取得（reviews / rating_purchases）。
 *   ・review_count / purchase_count のどちらか > 0 なら削除ボタンを出さず、編集ページの
 *     アーカイブへ誘導する（実際の禁止はサーバーの delete API が再カウントで担保）。
 *   ・両方 0 のときだけ「削除する（元に戻せません）」を出す。二度押しは submitting ガード。
 */
type Props = {
  staffId: string;
  name: string;
  photoUrl: string | null;
  photoPosX: number;
  photoPosY: number;
  photoZoom: number;
};

type Counts = { review_count: number; purchase_count: number };

export default function DeleteStaffButton({
  staffId,
  name,
  photoUrl,
  photoPosX,
  photoPosY,
  photoZoom,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // 開くたびに +1。portal の key に使い、毎回まっさらなモーダルDOMを生成する
  // （soft遷移で保持されたインスタンスの stale なモーダルDOMが再利用されるのを防ぐ）。
  const [openSeq, setOpenSeq] = useState(0);
  // モーダルは createPortal で body 直下に出す（transform を持つ祖先＝`.animate-in` に
  // position:fixed が閉じ込められて中央がビューポート外に飛ぶのを防ぐ）。mounted 後のみ portal。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // モーダル関連 state を完全に初期化（確認済み扱いの持ち越しを絶対に作らない）。
  function resetModal() {
    setOpen(false);
    setLoading(false);
    setCounts(null);
    setSubmitting(false);
    setError("");
  }

  async function openModal() {
    // 前回の counts / 確認状態を一切引き継がず、必ず「確認中→カウント取得」からやり直す。
    setError("");
    setCounts(null);
    setSubmitting(false);
    setLoading(true);
    setOpenSeq((n) => n + 1);
    setOpen(true);
    try {
      const res = await fetch(
        `/api/manager/staff/counts?staffId=${encodeURIComponent(staffId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("counts_failed");
      setCounts((await res.json()) as Counts);
    } catch {
      setError("実績件数を取得できませんでした。閉じてやり直してください。");
    } finally {
      setLoading(false);
    }
  }

  function closeModal() {
    if (submitting) return; // 削除処理中は閉じさせない
    resetModal();
  }

  async function handleDelete() {
    // 厳格ガード: モーダルが開いていて、かつ「この開いたセッションで取得した counts」が
    // 両方 0 のときだけ実行する。確認をスキップした delete を構造的に不能にする。
    if (submitting) return;
    if (
      !open ||
      counts === null ||
      counts.review_count !== 0 ||
      counts.purchase_count !== 0
    ) {
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/manager/staff/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId }),
      });
      if (!res.ok) {
        // サーバー側 guard（実績が増えていた等）に弾かれた場合も含めて優しく戻す。
        setError("削除できませんでした。時間をおいて再度お試しください。");
        setSubmitting(false);
        return;
      }
      // 成功: ローカル状態を完全リセットしてから一覧を更新。
      // ・router.refresh() は URL 不変でも必ず server component を再取得＝削除済みが確実に消える
      //   （同一 URL への push は no-op になり一覧が更新されない問題を避ける）。
      // ・?deleted=1 バナーは replace で付与（既に付いていれば no-op で無害）。
      resetModal();
      router.replace("/manager/staff?deleted=1");
      router.refresh();
    } catch {
      setError("通信に失敗しました。接続を確認して再度お試しください。");
      setSubmitting(false);
    }
  }

  const canHardDelete =
    counts !== null &&
    counts.review_count === 0 &&
    counts.purchase_count === 0;
  const hasRecords =
    counts !== null &&
    (counts.review_count > 0 || counts.purchase_count > 0);

  return (
    <>
      <button
        type="button"
        className="btn btn-quiet btn-block staff-delete-link"
        onClick={openModal}
      >
        削除
      </button>

      {open &&
        mounted &&
        createPortal(
          <div
            key={openSeq}
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={`${name} を削除`}
            onClick={closeModal}
          >
          <div
            className="modal-card stack"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-staff-head">
              <span className="staff-photo" aria-hidden="true">
                <LogoCircle
                  logoUrl={photoUrl}
                  x={photoPosX}
                  y={photoPosY}
                  zoom={photoZoom}
                  fallback={name.slice(0, 3)}
                />
              </span>
              <span className="modal-staff-name">{name}</span>
            </div>

            {error && (
              <p className="notice notice-error" role="alert">
                {error}
              </p>
            )}

            {loading && <p className="muted center-text">確認中…</p>}

            {!loading && counts && (
              <>
                <p className="muted">
                  紐づく実績：感想 {counts.review_count} 件 ／ 評価スタンプ{" "}
                  {counts.purchase_count} 件
                </p>

                {hasRecords ? (
                  <>
                    <p className="body">
                      実績が紐づいているため、削除はできません。退職の場合は「アーカイブ」を使ってください（実績は残ります）。
                    </p>
                    <Link
                      href={`/manager/staff/${staffId}`}
                      className="btn btn-outline btn-block"
                    >
                      編集ページでアーカイブする
                    </Link>
                    <button
                      type="button"
                      className="btn btn-quiet btn-block"
                      onClick={closeModal}
                    >
                      閉じる
                    </button>
                  </>
                ) : canHardDelete ? (
                  <>
                    <p className="body">
                      このスタッフのシステム上の記録は削除されます。
                      <strong>元に戻せません。</strong>
                      本当に削除しますか？
                    </p>
                    <button
                      type="button"
                      className="btn btn-outline btn-block"
                      onClick={handleDelete}
                      disabled={submitting}
                    >
                      {submitting ? "削除中…" : "削除する（元に戻せません）"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet btn-block"
                      onClick={closeModal}
                      disabled={submitting}
                    >
                      キャンセル
                    </button>
                  </>
                ) : null}
              </>
            )}

            {!loading && !counts && error && (
              <button
                type="button"
                className="btn btn-quiet btn-block"
                onClick={closeModal}
              >
                閉じる
              </button>
            )}
          </div>
        </div>,
          document.body,
        )}
    </>
  );
}
