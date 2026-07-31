"use client";

import { clsx } from "@/lib/format";

export function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: string; label: string; hint?: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      className="inline-flex rounded-md border border-ink-600 bg-ink-900 p-0.5"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.hint}
            onClick={() => onChange(opt.value)}
            className={clsx(
              "rounded px-3 py-1.5 text-sm transition-colors duration-150 ease-out",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500",
              active
                ? "bg-ink-700 text-copper-300 shadow-none"
                : "text-stone-400 hover:text-stone-200"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
