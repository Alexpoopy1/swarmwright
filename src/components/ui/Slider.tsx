"use client";

import * as React from "react";
import { clsx } from "@/lib/format";

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  formatValue,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label?: string;
  formatValue?: (v: number) => string;
}) {
  const id = React.useId();
  return (
    <div className="w-full">
      {label && (
        <div className="mb-1.5 flex items-center justify-between">
          <label htmlFor={id} className="text-sm text-stone-300">
            {label}
          </label>
          <span className="font-mono text-sm text-copper-300">
            {formatValue ? formatValue(value) : value}
          </span>
        </div>
      )}
      <input
        id={id}
        type="range"
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={clsx(
          "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-ink-700 accent-copper-500",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500",
          "[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none",
          "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-copper-500 [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-copper-700",
          "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full",
          "[&::-moz-range-thumb]:bg-copper-500 [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-copper-700"
        )}
      />
      {!label && (
        <div className="mt-1 text-right font-mono text-xs text-copper-300">
          {formatValue ? formatValue(value) : value}
        </div>
      )}
    </div>
  );
}
