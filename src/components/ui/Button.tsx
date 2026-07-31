"use client";

import * as React from "react";
import { clsx } from "@/lib/format";
import { Spinner } from "./Spinner";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
}

const VARIANTS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-copper-600 text-stone-100 hover:bg-copper-500 border border-copper-700 disabled:hover:bg-copper-600",
  secondary:
    "bg-ink-800 text-stone-200 hover:bg-ink-700 border border-ink-600 disabled:hover:bg-ink-800",
  ghost: "bg-transparent text-stone-300 hover:bg-ink-800 border border-transparent",
  danger:
    "bg-ember-500/15 text-ember-400 hover:bg-ember-500/25 border border-ember-500/40",
};

const SIZES: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, disabled, className, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        "inline-flex items-center justify-center rounded-md font-medium transition-colors duration-150 ease-out",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...rest}
    >
      {loading && <Spinner size={size === "sm" ? 12 : 14} />}
      {children}
    </button>
  );
});
