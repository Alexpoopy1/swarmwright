import * as React from "react";
import { clsx } from "@/lib/format";

export type BadgeTone = "copper" | "sage" | "ember" | "stone" | "amber";

const TONES: Record<BadgeTone, string> = {
  copper: "bg-copper-600/15 text-copper-300 border-copper-600/40",
  sage: "bg-sage-500/15 text-sage-400 border-sage-500/40",
  ember: "bg-ember-500/15 text-ember-400 border-ember-500/40",
  stone: "bg-ink-700/60 text-stone-300 border-ink-600",
  amber: "bg-amber-500/15 text-amber-400 border-amber-500/40",
};

export function Badge({
  tone = "stone",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-medium leading-4",
        TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
