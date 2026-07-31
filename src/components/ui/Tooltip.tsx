import * as React from "react";

/**
 * Accessible tooltip: exposes the content via title (native) and a
 * CSS-only visual bubble on hover/focus-within.
 */
export function Tooltip({ content, children }: { content: string; children: React.ReactNode }) {
  return (
    <span className="group relative inline-flex" title={content}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-stone-200 opacity-0 shadow-lg transition-opacity duration-150 ease-out group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {content}
      </span>
    </span>
  );
}
