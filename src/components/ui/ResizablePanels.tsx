"use client";

import * as React from "react";
import { clsx } from "@/lib/format";

/**
 * Horizontal split with a drag handle. Arrow keys on the handle resize by 2%.
 * Ratio persists in localStorage when `storageKey` is provided.
 */
export function ResizablePanels({
  left,
  right,
  defaultRatio = 0.5,
  minRatio = 0.2,
  storageKey,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  defaultRatio?: number;
  minRatio?: number;
  storageKey?: string;
}) {
  const [ratio, setRatio] = React.useState(defaultRatio);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const draggingRef = React.useRef(false);
  const maxRatio = 1 - minRatio;

  React.useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = window.localStorage.getItem(`sw.panels.${storageKey}`);
      if (saved) {
        const v = Number(saved);
        if (Number.isFinite(v) && v >= minRatio && v <= maxRatio) setRatio(v);
      }
    } catch {
      // localStorage unavailable
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const clamp = React.useCallback(
    (v: number) => Math.min(maxRatio, Math.max(minRatio, v)),
    [minRatio, maxRatio]
  );

  const persist = React.useCallback(
    (v: number) => {
      if (!storageKey) return;
      try {
        window.localStorage.setItem(`sw.panels.${storageKey}`, String(v));
      } catch {
        // ignore
      }
    },
    [storageKey]
  );

  function onPointerDown(e: React.PointerEvent) {
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!draggingRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const next = clamp((e.clientX - rect.left) / rect.width);
    setRatio(next);
  }

  function onPointerUp() {
    if (draggingRef.current) persist(ratio);
    draggingRef.current = false;
  }

  function onKeyDown(e: React.KeyboardEvent) {
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = clamp(ratio - 0.02);
    if (e.key === "ArrowRight") next = clamp(ratio + 0.02);
    if (next !== null) {
      e.preventDefault();
      setRatio(next);
      persist(next);
    }
  }

  return (
    <div
      ref={containerRef}
      className="flex h-full w-full overflow-hidden"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="min-w-0 overflow-auto" style={{ width: `${ratio * 100}%` }}>
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panels"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={Math.round(minRatio * 100)}
        aria-valuemax={Math.round(maxRatio * 100)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        className={clsx(
          "w-1.5 shrink-0 cursor-col-resize bg-ink-800 transition-colors duration-150 hover:bg-copper-700",
          "focus-visible:outline-none focus-visible:bg-copper-700 focus-visible:ring-1 focus-visible:ring-copper-500"
        )}
      />
      <div className="min-w-0 flex-1 overflow-auto">{right}</div>
    </div>
  );
}
