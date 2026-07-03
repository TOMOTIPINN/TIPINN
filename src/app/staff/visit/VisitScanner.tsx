"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Card, VipBadge } from "@/components/ui";

/**
 * 来店受付スキャナ（/staff/visit・クライアント / 来店スライス1・LINE無し）。
 *
 * お客様が /mypage で提示するQR（中身＝customer_id 生UUID）を、カメラ or 画像アップロードで読み取る。
 * 読み取り→ /api/staff/visit(lookup) で確認カード（名前・累計来店・VIP）→「来店を記録」で record。
 * 本日すでに記録済みなら awarded=false で「本日は記録済みです」を明示（エラー画面にしない）。
 *
 * 書き込み・salon スコープはすべて API 側（getStaffContext・ctx.salon_id）。ここは表示と読み取りのみ。
 * §8 インラインstyle無し（.visit-scan* は globals.css）。§5 ¥・鮮やか色を出さない。
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Phase = "scanning" | "looking" | "confirm" | "recording" | "done";

type Target = {
  customerId: string;
  name: string;
  visitCount: number;
  isVIP: boolean;
};

type Result = { name: string; awarded: boolean; newCount: number };

export default function VisitScanner() {
  const [phase, setPhase] = useState<Phase>("scanning");
  const [error, setError] = useState<string | null>(null);
  const [cameraOff, setCameraOff] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [result, setResult] = useState<Result | null>(null);

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

  const reset = useCallback(() => {
    setTarget(null);
    setResult(null);
    setError(null);
    setPhase("scanning");
  }, []);

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
                <button
                  type="button"
                  className="btn btn-outline btn-block"
                  onClick={record}
                  disabled={phase === "recording"}
                >
                  {phase === "recording" ? "記録しています…" : "来店を記録"}
                </button>
                <button
                  type="button"
                  className="btn btn-quiet btn-block"
                  onClick={reset}
                  disabled={phase === "recording"}
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
