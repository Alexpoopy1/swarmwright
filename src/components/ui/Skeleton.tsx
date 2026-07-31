import { clsx } from "@/lib/format";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={clsx("animate-pulse rounded-md bg-ink-800", className)}
    />
  );
}
