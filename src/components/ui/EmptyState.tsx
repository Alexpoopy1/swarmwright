import * as React from "react";
import { clsx } from "@/lib/format";

export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center justify-center rounded-md border border-dashed border-ink-600 px-6 py-12 text-center",
        className
      )}
    >
      {icon && <div className="mb-3 text-stone-500">{icon}</div>}
      <p className="text-sm font-medium text-stone-300">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-stone-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
