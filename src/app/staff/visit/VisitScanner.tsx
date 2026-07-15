"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Card, VipBadge } from "@/components/ui";

/**
 * 来店受付スキャナ（/staff/visit・クライアント / 来店スライス1・LINE無し）。
 *
 * お客様が /mypage で提示するQR（中身＝customer_id 生UUID）を、カメラ or 画像アップロードで読み取る。
 * 読み取り→ /api/staff/visit(lookup) で確認カード（名前・累計来店・VIP・移行状態）→「来店を記録」で record。
 * 本日すでに記録済みなら awarded=false で「本日は記録済みです」を明示（エラー画面にしない）。
 *
 * 旧LINEショップカードの移行（stamp_adjustments・0019）:
 *   ・未移行なら残数入力欄を出し、値ありなら「移行して記録」1タップで migrate→record を連続実行。
 *   ・既移行なら移行済み表示＋「訂正」（在籍staff/端末いずれも可・ロール判定なし）。
 *   ・入力範囲は 0〜そのサロンのハードル値（cycleSize）。誰が入力/訂正したかはサーバー側で追跡保持。
 *
 * 書き込み・salon スコープはすべて API 側（getVisitContext・ctx.salon_id）。ここは表示と読み取りのみ。
 * §8 インラインstyle無し（.visit-scan* / .field は globals.css）。§5 ¥・鮮やか色を出さない。
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Phase = "scanning" | "looking" | "confirm" | "recording" | "done";

type Target = {
  customerId: string;
  name: string;
  visitCount: number; // 実来店 + 移行delta の合算
  isVIP: boolean;
  migrated: boolean;
  migrationDelta: number;
  // 移行後 visit（実来店）が2回以下＝訂正ボタンを出してよい（3回目以降は隠す）。
  migrationCorrectable: boolean;
  cycleSize: number; // 移行入力の上限（salons.visit_cycle_size）
};

type Result = { name: string; awarded: boolean; newCount: number };

export default function VisitScanner() {
  const [phase, setPhase] = useState<Phase>("scanning");
  const [error, setError] = useState<string | null>(null);
  const [cameraOff, setCameraOff] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  // 移行入力（未移行時）と訂正入力（既移行時）。migrating は migrate 通信中フラグ。
  const [migrateValue, setMigrateValue] = useState("");
  const [editValue, setEditValue] = useState("");
  const [editingMigration, setEditingMigration] = useState(false);
  const [migrating, setMigrating] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // 読み取りループの多重発火・record 後の再検出を止めるためのラッチ。
  const lockedRef = useRef(false);

  // QR文字列をサーバーに問い合わせ、確認カードへ（lookup）。
  const handleDecoded = useCallback(async (raw: string) => {
    const customerId = raw.trim();
    if (!UUID_RE.test(customerId)) {
      setError("QRを読み取れませんでした。もう一度、お客様のQRを画面に合わせてください。");
      lockedRef.current = false; // 読み取り継続
      return;
    }
    lockedRef.current = true; // 以降のフレーム検出を止める
    setError(null);
    setPhase("looking");
    try {
      const res = await fetch("/api/staff/visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "lookup", customer_id: customerId }),
      });
      if (res.status === 404) {
        setError("このQRのお客様が見つかりません。echo に登録済みのQRかご確認ください。");
        setPhase("scanning");
        lockedRef.current = false;
        return;
      }
      if (!res.ok) {
        setError("読み取りに失敗しました。もう一度お試しください。");
        setPhase("scanning");
        lockedRef.current = false;
        return;
      }
      const data = (await res.json()) as Omit<Target, "customerId">;
      setTarget({ customerId, ...data });
      setMigrateValue("");
      setEditingMigration(false);
      setPhase("confirm");
    } catch {
      setError("通信に失敗しました。電波状況をご確認ください。");
      setPhase("scanning");
      lockedRef.current = false;
    }
  }, []);

  // カメラ起動＋フレーム走査（phase==="scanning" のときだけ動かし、離脱時に停止）。
  useEffect(() => {
    if (phase !== "scanning") return;
    lockedRef.current = false;

    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;
    // cleanup で参照する video 要素を effect 実行時点で確保（ref の遅延変化を避ける）。
    const videoEl = videoRef.current;

    const tick = () => {
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (
        !lockedRef.current &&
        video &&
        canvas &&
        video.readyState === video.HAVE_ENOUGH_DATA
      ) {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w && h) {
          canvas.width = w;
          canvas.height = h;
          const cctx = canvas.getContext("2d", { willReadFrequently: true });
          if (cctx) {
            cctx.drawImage(video, 0, 0, w, h);
            const img = cctx.getImageData(0, 0, w, h);
            const code = jsQR(img.data, w, h, {
              inversionAttempts: "dontInvert",
            });
            if (code?.data) {
              handleDecoded(code.data);
            }
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setCameraOff(false);
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
        }
        raf = requestAnimationFrame(tick);
      } catch {
        // 権限拒否・カメラ無し → 画像アップロードに切り替え（機能自体は継続）。
        setCameraOff(true);
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (videoEl) videoEl.srcObject = null;
    };
  }, [phase, handleDecoded]);

  // 画像アップロードから読み取る（カメラ不可時のフォールバック・PCデモにも便利）。
  const onFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ""; // 同じファイルを連続選択できるように
      if (!file) return;
      try {
        const bitmap = await createImageBitmap(file);
        // アップロード読み取りは走査用 ref とは別の一時 canvas で行う（ref を書き換えない）。
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const cctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!cctx) return;
        cctx.drawImage(bitmap, 0, 0);
        const img = cctx.getImageData(0, 0, bitmap.width, bitmap.height);
        const code = jsQR(img.data, bitmap.width, bitmap.height);
        if (code?.data) {
          await handleDecoded(code.data);
        } else {
          setError("画像からQRを読み取れませんでした。QR全体が写った画像をお選びください。");
        }
      } catch {
        setError("画像の読み込みに失敗しました。");
      }
    },
    [handleDecoded],
  );

  // 移行台帳への入力/訂正（migrate）。成功で確認カードの累計を即更新。true=成功。
  const doMigrate = useCallback(
    async (deltaNum: number): Promise<boolean> => {
      if (!target) return false;
      setMigrating(true);
      setError(null);
      try {
        const res = await fetch("/api/staff/visit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "migrate",
            customer_id: target.customerId,
            delta: deltaNum,
          }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          setError(
            j?.error === "out_of_range"
              ? `残数は 0〜${target.cycleSize} で入力してください。`
              : "移行の保存に失敗しました。もう一度お試しください。",
          );
          setMigrating(false);
          return false;
        }
        const data = (await res.json()) as {
          migrationDelta: number;
          visitCount: number;
        };
        setTarget((t) =>
          t
            ? {
                ...t,
                migrated: true,
                migrationDelta: data.migrationDelta,
                visitCount: data.visitCount,
              }
            : t,
        );
        setMigrating(false);
        return true;
      } catch {
        setError("通信に失敗しました。電波状況をご確認ください。");
        setMigrating(false);
        return false;
      }
    },
    [target],
  );

  // 確認カードの「来店を記録」。1日1回・累計はサーバー(RPC)が返す。
  const record = useCallback(async () => {
    if (!target) return;
    setPhase("recording");
    setError(null);
    try {
      const res = await fetch("/api/staff/visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "record",
          customer_id: target.customerId,
        }),
      });
      if (!res.ok) {
        setError("記録に失敗しました。もう一度お試しください。");
        setPhase("confirm");
        return;
      }
      const data = (await res.json()) as Result;
      setResult(data);
      setPhase("done");
    } catch {
      setError("通信に失敗しました。電波状況をご確認ください。");
      setPhase("confirm");
    }
  }, [target]);

  // 主ボタン: 未移行かつ残数入力ありなら「移行して記録」（migrate→record）、それ以外は record のみ。
  const wantMigrate =
    !!target && !target.migrated && migrateValue.trim() !== "";
  const migrateDelta = Number(migrateValue);
  const migrateInvalid =
    wantMigrate &&
    (!Number.isInteger(migrateDelta) ||
      migrateDelta < 0 ||
      (!!target && migrateDelta > target.cycleSize));

  const onPrimary = useCallback(async () => {
    if (wantMigrate) {
      const ok = await doMigrate(migrateDelta);
      if (!ok) return; // 移行失敗時は記録しない
    }
    await record();
  }, [wantMigrate, doMigrate, migrateDelta, record]);

  const reset = useCallback(() => {
    setTarget(null);
    setResult(null);
    setError(null);
    setMigrateValue("");
    setEditValue("");
    setEditingMigration(false);
    setMigrating(false);
    setPhase("scanning");
  }, []);

  const busy = phase === "recording" || migrating;

  return (
    <div className="stack">
      {error && <div className="notice notice-error">{error}</div>}

      {(phase === "scanning" || phase === "looking") && (
        <Card>
          <div className="stack stack-md">
            {cameraOff ? (
              <p className="muted center-text">
                カメラを利用できません。下のボタンからQRの画像を選んで読み取れます。
              </p>
            ) : (
              <div className="visit-scan-frame">
                <video
                  ref={videoRef}
                  className="visit-scan-video"
                  playsInline
                  muted
                />
                <span className="visit-scan-reticle" aria-hidden="true" />
              </div>
            )}

            <p className="muted center-text">
              {phase === "looking"
                ? "お客様を確認しています…"
                : "お客様のマイページのQRを枠に合わせてください。"}
            </p>

            <label className="btn btn-quiet btn-block visit-scan-upload">
              QRの画像を選ぶ
              <input
                type="file"
                accept="image/*"
                onChange={onFile}
                className="visit-scan-file"
              />
            </label>
          </div>
        </Card>
      )}

      {phase !== "scanning" && phase !== "looking" && target && (
        <Card>
          <div className="stack stack-md center-text">
            <div className="visit-confirm-name">
              <span className="headline-sm">{target.name} さま</span>
              {(phase === "confirm" || phase === "recording") &&
                target.isVIP && <VipBadge />}
              {phase === "done" && result?.awarded && target.isVIP && (
                <VipBadge />
              )}
            </div>

            {(phase === "confirm" || phase === "recording") && (
              <>
                <p className="muted">
                  累計来店 {target.visitCount} 回
                  {target.isVIP ? "・VIP" : ""}
                </p>

                {/* 未移行: 旧カード残数の入力欄（任意）。値ありなら主ボタンが「移行して記録」に。 */}
                {!target.migrated && (
                  <div className="stack stack-sm">
                    <label className="field-label" htmlFor="migrate-delta">
                      旧LINEショップカードの残り（任意・0〜{target.cycleSize}）
                    </label>
                    <input
                      id="migrate-delta"
                      type="number"
                      min={0}
                      max={target.cycleSize}
                      inputMode="numeric"
                      className="field"
                      value={migrateValue}
                      onChange={(e) => setMigrateValue(e.target.value)}
                      placeholder="0"
                      disabled={busy}
                    />
                  </div>
                )}

                {/* 既移行: 移行済み表示＋訂正（在籍staff/端末いずれも可）。 */}
                {target.migrated && (
                  <div className="stack stack-sm">
                    <p className="muted">
                      旧カード移行済み：{target.migrationDelta} 個
                    </p>
                    {/* 訂正ボタンは移行後 visit が2回以下のときだけ。3回目以降は隠す
                        （旧カード残数は移行時に確定・訂正は入力ミス直後だけ・画面ノイズ低減）。 */}
                    {target.migrationCorrectable &&
                      (editingMigration ? (
                      <>
                        <input
                          type="number"
                          min={0}
                          max={target.cycleSize}
                          inputMode="numeric"
                          className="field"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          disabled={busy}
                        />
                        <button
                          type="button"
                          className="btn btn-outline btn-block"
                          disabled={busy}
                          onClick={async () => {
                            const v = Number(editValue);
                            if (
                              !Number.isInteger(v) ||
                              v < 0 ||
                              v > target.cycleSize
                            ) {
                              setError(
                                `残数は 0〜${target.cycleSize} で入力してください。`,
                              );
                              return;
                            }
                            const ok = await doMigrate(v);
                            if (ok) setEditingMigration(false);
                          }}
                        >
                          {migrating ? "保存しています…" : "訂正を保存"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-quiet btn-block"
                          disabled={busy}
                          onClick={() => setEditingMigration(false)}
                        >
                          やめる
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-subtle btn-block"
                        disabled={busy}
                        onClick={() => {
                          setEditValue(String(target.migrationDelta));
                          setEditingMigration(true);
                        }}
                      >
                        旧カード残数を訂正
                      </button>
                      ))}
                  </div>
                )}

                <button
                  type="button"
                  className="btn btn-outline btn-block"
                  onClick={onPrimary}
                  disabled={busy || migrateInvalid || editingMigration}
                >
                  {phase === "recording"
                    ? "記録しています…"
                    : migrating
                      ? "移行しています…"
                      : wantMigrate
                        ? "移行して記録"
                        : "来店を記録"}
                </button>
                <button
                  type="button"
                  className="btn btn-quiet btn-block"
                  onClick={reset}
                  disabled={busy}
                >
                  やめる
                </button>
              </>
            )}

            {phase === "done" && result && (
              <>
                {result.awarded ? (
                  <p className="body">
                    来店スタンプ +1（累計 {result.newCount} 回）
                  </p>
                ) : (
                  <p className="muted">
                    本日は記録済みです（累計 {result.newCount} 回）
                  </p>
                )}
                <button
                  type="button"
                  className="btn btn-outline btn-block"
                  onClick={reset}
                >
                  続けて読み取る
                </button>
              </>
            )}
          </div>
        </Card>
      )}

      {/* オフスクリーン走査用（表示しない）。 */}
      <canvas ref={canvasRef} className="visit-scan-canvas" />

      <Link href="/staff" className="btn btn-quiet btn-block">
        スタッフホームへ
      </Link>
    </div>
  );
}
