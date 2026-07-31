"use client";

import * as React from "react";
import { clsx } from "@/lib/format";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={clsx(
          "h-9 w-full rounded-md border border-ink-600 bg-ink-900 px-3 text-sm text-stone-200",
          "placeholder:text-stone-500 transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500 focus-visible:border-copper-600",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...rest}
      />
    );
  }
);
