"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 自前の月ピッカー（ネイティブ <input type="month"> の置換・サロンUI）。
 *
 * 目的: ブラウザ標準UIは角丸ゼロ＝echo のデザイン言語と不整合／Chrome・Safari・iPad で見た目が割れる。
 *   トリガー（.field 準拠）＋ポップオーバー（年送り＋1〜12月グリッド）を既存トークンで組む。
 *   出力は "YYYY-MM"（親は従来どおり router.push へ流すだけ・period.ts は不変）。
 *
 * 挙動:
 *  - 外側 pointerdown / Esc で閉じる（Esc・選択・トリガー再押下はトリガーへフォーカスを戻す）。
 *  - min/max（inclusive・"YYYY-MM"）の範囲外の月は選べない（is-disabled・押下は no-op）＝
 *    「開始月 > 終了月」「未来月」を構造的に不可にする（親が max=終了月/当月, min=開始月 を渡す）。
 *  - キーボード: Tab でグリッドに入り、矢印で移動（roving tabindex）、Enter/Space で選択。
 *  - タッチ端末の hover 貼り付き回避は CSS 側 @media (hover: hover)（CLAUDE.md 鉄則(d)）。
 *
 * スタイルは globals.css の .month-* クラス（既存トークン・mint active）。インラインstyle無し（§8）。
 */

const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
// resolvePeriod（period.ts）と同じ下限年。年送りの床。
const FLOOR_YEAR = 2020;

type YM = { y: number; m: number }; // m: 1..12

function parseYM(v: string): YM | null {
  if (!/^\d{4}-\d{2}$/.test(v)) return null;
  const y = Number(v.slice(0, 4));
  const m = Number(v.slice(5, 7));
  if (m < 1 || m > 12) return null;
  return { y, m };
}
function fmtYM(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}`;
}
function fmtLabel(v: string): string {
  const p = parseYM(v);
  return p ? `${p.y}年${p.m}月` : "";
}
// 月を一意な整数に（比較用）。
function rankOf(y: number, m1to12: number): number {
  return y * 12 + (m1to12 - 1);
}

export default function MonthPicker({
  value,
  onChange,
  min,
  max,
  ariaLabel,
  placeholder,
}: {
  value: string; // "YYYY-MM" or ""
  onChange: (v: string) => void;
  min?: string; // inclusive "YYYY-MM"
  max?: string; // inclusive "YYYY-MM"
  ariaLabel: string;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState<number>(FLOOR_YEAR);
  const [focusIdx, setFocusIdx] = useState<number>(0); // 0..11 roving

  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pendingFocus = useRef(false);

  const sel = parseYM(value);
  const minP = min ? parseYM(min) : null;
  const maxP = max ? parseYM(max) : null;
  const minRank = minP ? rankOf(minP.y, minP.m) : rankOf(FLOOR_YEAR, 1);
  const maxRank = maxP ? rankOf(maxP.y, maxP.m) : null;
  const minYear = Math.floor(minRank / 12);
  const maxYear = maxRank !== null ? Math.floor(maxRank / 12) : viewYear + 1;

  function available(vy: number, idx0to11: number): boolean {
    const r = rankOf(vy, idx0to11 + 1);
    return r >= minRank && (maxRank === null || r <= maxRank);
  }
  // vy 内で選択のデフォルトに置く月（末尾寄りの選択可能月・無ければ 0）。
  function defaultIdx(vy: number): number {
    for (let i = 11; i >= 0; i--) if (available(vy, i)) return i;
    return 0;
  }

  function focusCell(i: number) {
    cellRefs.current[i]?.focus();
  }

  function openPicker() {
    const vy = sel ? sel.y : maxP ? maxP.y : minP ? minP.y : FLOOR_YEAR;
    const idx = sel && sel.y === vy ? sel.m - 1 : defaultIdx(vy);
    setViewYear(vy);
    setFocusIdx(idx);
    setOpen(true);
  }

  function selectMonth(i: number) {
    if (!available(viewYear, i)) return;
    onChange(fmtYM(viewYear, i + 1));
    setOpen(false);
    triggerRef.current?.focus();
  }

  function goYear(delta: number) {
    const ny = viewYear + delta;
    if (ny < minYear || (maxRank !== null && ny > maxYear)) return;
    setViewYear(ny);
    setFocusIdx(defaultIdx(ny));
    pendingFocus.current = true;
  }

  function onGridKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    let idx = focusIdx;
    switch (e.key) {
      case "ArrowRight":
        idx = Math.min(11, focusIdx + 1);
        break;
      case "ArrowLeft":
        idx = Math.max(0, focusIdx - 1);
        break;
      case "ArrowDown":
        idx = Math.min(11, focusIdx + 4);
        break;
      case "ArrowUp":
        idx = Math.max(0, focusIdx - 4);
        break;
      default:
        return;
    }
    e.preventDefault();
    setFocusIdx(idx);
    focusCell(idx);
  }

  // 開いたら初期セルへフォーカス。
  useEffect(() => {
    if (open) focusCell(focusIdx);
    // focusIdx は open と同一バッチで確定済み。open の立ち上がりだけで発火させる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 年送り後、選択可能セルへフォーカスを移す。
  useEffect(() => {
    if (open && pendingFocus.current) {
      pendingFocus.current = false;
      focusCell(focusIdx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewYear]);

  // 外側クリック（pointerdown＝マウス/タッチ両対応）と Esc で閉じる。
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onPointer(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const prevDisabled = viewYear <= minYear;
  const nextDisabled = maxRank !== null && viewYear >= maxYear;

  return (
    <div className="month-field" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`field month-trigger${value ? "" : " is-empty"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openPicker())}
      >
        {value ? fmtLabel(value) : placeholder}
      </button>

      {open && (
        <div className="month-pop" role="dialog" aria-label={ariaLabel}>
          <div className="month-pop-head">
            <button
              type="button"
              className="month-nav"
              aria-label="前の年"
              disabled={prevDisabled}
              onClick={() => goYear(-1)}
            >
              ‹
            </button>
            <span className="month-year" aria-live="polite">
              {viewYear}年
            </span>
            <button
              type="button"
              className="month-nav"
              aria-label="次の年"
              disabled={nextDisabled}
              onClick={() => goYear(1)}
            >
              ›
            </button>
          </div>

          <div
            className="month-grid"
            role="group"
            aria-label={`${viewYear}年 月を選択`}
            onKeyDown={onGridKeyDown}
          >
            {MONTHS.map((label, i) => {
              const avail = available(viewYear, i);
              const selected = !!sel && sel.y === viewYear && sel.m === i + 1;
              return (
                <button
                  key={i}
                  ref={(el) => {
                    cellRefs.current[i] = el;
                  }}
                  type="button"
                  className={`month-cell${selected ? " is-active" : ""}${avail ? "" : " is-disabled"}`}
                  aria-pressed={selected || undefined}
                  aria-disabled={avail ? undefined : true}
                  tabIndex={focusIdx === i ? 0 : -1}
                  onClick={() => selectMonth(i)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
