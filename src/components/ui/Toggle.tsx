"use client";

import { clsx } from "@/lib/format";

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ?? "toggle"}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 ease-out",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-copper-600 bg-copper-600/40" : "border-ink-600 bg-ink-700"
      )}
    >
      <span
        className={clsx(
          "inline-block h-3.5 w-3.5 rounded-full transition-transform duration-150 ease-out",
          checked ? "translate-x-[18px] bg-copper-300" : "translate-x-[3px] bg-stone-400"
        )}
      />
    </button>
  );
}
