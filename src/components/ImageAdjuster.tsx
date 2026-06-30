"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, PointerEvent, ReactNode } from "react";
import { LogoCircle } from "@/components/LogoCircle";

/**
 * 画像の位置調整・ズーム編集UI（汎用 / client）。サロンロゴ・スタッフ写真の両方で使う。
 *
 * 円の中をドラッグで移動（Pointer Events ＝ マウス/タッチ/ペン統一・スマホ対応）＋
 * スライダーでズーム。調整値は hidden input（フィールド名は props で指定）に同期し、
 * 親の <form>（multipart）でファイルと一緒にPOSTする。
 *
 * 表示は @/components/LogoCircle に委譲（CSS変数→transform）。編集中のプレビューと
 * 保存後の表示は同じ LogoCircle / 同じ transform 計算なので必ず一致する。
 * 値域はサーバー(API)・DB(CHECK)と同じ -50..50(%) / 1..3 にクライアントでもクランプ。
 *
 * ロゴ固有・写真固有なのは「フォームのフィールド名」と「文言」だけ。コア（ドラッグ／
 * ズーム／aspect可動域計算）は両用途で完全に同一。
 */
const ZOOM_MIN = 1;
const ZOOM_MAX = 3;

// 未調整／新規アップロード時の初期ズーム。最小(1)だとスライダーが左端＝可動域0で
// 「ズームしか操作できない」ため、少しだけ寄せて左右ドラッグの余白を最初から作る。
// DBには保存時のみ反映（初期表示だけの値）。
const INITIAL_UNADJUSTED_ZOOM = 1.2;

/**
 * 円を背景で割らずに動かせる軸ごとの最大移動量（円幅に対する％）。
 *
 * object-fit:cover は短辺を円に合わせ、長辺を切る。そのため長辺方向は zoom=1 でも
 * 切れている分だけ動かせる（＝可動域 > 0）。aspect = 画像の 幅/高さ。
 *   横長(aspect>=1): x は (aspect*zoom - 1)/2、y は (zoom - 1)/2
 *   縦長(aspect<1) : x は (zoom - 1)/2、     y は (zoom/aspect - 1)/2
 */
function axisLimits(zoom: number, aspect: number): { x: number; y: number } {
  const xExtent = aspect >= 1 ? aspect : 1; // cover後の幅 / 円幅
  const yExtent = aspect >= 1 ? 1 : 1 / aspect; // cover後の高さ / 円幅
  return {
    x: Math.max(0, ((xExtent * zoom - 1) / 2) * 100),
    y: Math.max(0, ((yExtent * zoom - 1) / 2) * 100),
  };
}
function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

export function ImageAdjuster({
  initialImageUrl,
  initialX,
  initialY,
  initialZoom,
  fileFieldName,
  posXFieldName,
  posYFieldName,
  zoomFieldName,
  fileLabel,
  emptyLabel,
}: {
  initialImageUrl: string | null;
  initialX: number;
  initialY: number;
  initialZoom: number;
  // フォーム送信のキー（用途ごとに差し替え：logo / photo）
  fileFieldName: string;
  posXFieldName: string;
  posYFieldName: string;
  zoomFieldName: string;
  // 文言
  fileLabel: string;
  emptyLabel?: ReactNode;
}) {
  // 未調整（DB既定のまま）＝画像はあるが位置調整されていない場合は、初期表示だけ
  // 少しズームした状態で開く（保存するまでDBは書き換えない）。調整済みは保存値を尊重。
  const isUnadjusted = initialX === 0 && initialY === 0 && initialZoom === 1;

  const [imageUrl, setImageUrl] = useState<string | null>(initialImageUrl);
  const [x, setX] = useState(initialX);
  const [y, setY] = useState(initialY);
  const [zoom, setZoom] = useState(
    initialImageUrl && isUnadjusted ? INITIAL_UNADJUSTED_ZOOM : initialZoom,
  );
  // 画像の縦横比（幅/高さ）。可動域の計算に使う。計測できるまでは null（保存値を尊重）。
  const [aspect, setAspect] = useState<number | null>(null);

  const circleRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{
    px: number;
    py: number;
    x: number;
    y: number;
  } | null>(null);
  // onload コールバックから最新の zoom を読むための ref（クロージャの陳腐化回避）。
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // 画像が変わったら自然サイズから縦横比を計測し、現在位置を新しい可動域へ再クランプ。
  // setState は async な onload 内のみ（effect 本体では呼ばない）。
  useEffect(() => {
    if (!imageUrl) return;
    const img = new window.Image();
    img.onload = () => {
      if (img.naturalHeight <= 0) return;
      const a = img.naturalWidth / img.naturalHeight;
      setAspect(a);
      const lim = axisLimits(zoomRef.current, a);
      setX((px) => clamp(px, lim.x));
      setY((py) => clamp(py, lim.y));
    };
    img.src = imageUrl;
  }, [imageUrl]);

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // 新しい画像はローカルプレビュー（object URL）。調整値は初期化してやり直し。
    // ズームは既定と同じ 1.2 始まり（一貫性・最初から左右に動かせる）。
    setImageUrl(URL.createObjectURL(file));
    setX(0);
    setY(0);
    setZoom(INITIAL_UNADJUSTED_ZOOM);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!imageUrl) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { px: e.clientX, py: e.clientY, x, y };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const start = dragStart.current;
    if (!start) return;
    const rect = circleRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    // 移動px → 円幅に対する％。translate(%) はサイズ非依存なので保存値もこの単位。
    const dxPct = ((e.clientX - start.px) / rect.width) * 100;
    const dyPct = ((e.clientY - start.py) / rect.height) * 100;
    const lim = axisLimits(zoom, aspect ?? 1);
    setX(clamp(start.x + dxPct, lim.x));
    setY(clamp(start.y + dyPct, lim.y));
  }

  function onPointerUp() {
    dragStart.current = null;
  }

  function onZoomChange(e: ChangeEvent<HTMLInputElement>) {
    const z = Number(e.target.value);
    setZoom(z);
    // ズームアウトで可動域が縮むので、現在位置を新しい範囲へ再クランプ。
    const lim = axisLimits(z, aspect ?? 1);
    setX((px) => clamp(px, lim.x));
    setY((py) => clamp(py, lim.y));
  }

  return (
    <div className="stack stack-md">
      <div className="field-group">
        <label className="field-label" htmlFor={fileFieldName}>
          {fileLabel}
        </label>
        <input
          id={fileFieldName}
          name={fileFieldName}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="field"
          onChange={onFileChange}
        />
        <span className="field-help">
          正方形の画像を推奨します。対応形式：PNG / JPEG / WebP。上限2MB。
        </span>
      </div>

      <div
        ref={circleRef}
        className={`image-adjust-circle${imageUrl ? " is-draggable" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {imageUrl ? (
          <LogoCircle logoUrl={imageUrl} x={x} y={y} zoom={zoom} />
        ) : (
          <span className="image-adjust-empty">{emptyLabel}</span>
        )}
      </div>

      <div className="field-group">
        <label className="field-label" htmlFor={`${fileFieldName}_zoom_range`}>
          ズーム
        </label>
        <input
          id={`${fileFieldName}_zoom_range`}
          type="range"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={0.01}
          value={zoom}
          onChange={onZoomChange}
          className="image-zoom-range"
          disabled={!imageUrl}
        />
        <span className="field-help">
          円の中をドラッグで移動・スライダーで拡大できます。
        </span>
      </div>

      {/* 保存値（親フォームと一緒にPOST）。サーバー側でも数値検証＋クランプする。 */}
      <input type="hidden" name={posXFieldName} value={x} />
      <input type="hidden" name={posYFieldName} value={y} />
      <input type="hidden" name={zoomFieldName} value={zoom} />
    </div>
  );
}
