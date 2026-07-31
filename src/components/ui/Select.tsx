"use client";

import * as React from "react";
import { clsx } from "@/lib/format";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select
        ref={ref}
        className={clsx(
          "h-9 w-full rounded-md border border-ink-600 bg-ink-900 px-2.5 text-sm text-stone-200",
          "transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500 focus-visible:border-copper-600",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...rest}
      >
        {children}
      </select>
    );
  }
);
