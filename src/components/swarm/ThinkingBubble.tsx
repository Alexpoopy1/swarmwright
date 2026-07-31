/**
 * ThinkingBubble — the latest user-safe activity summary next to an agent's
 * name (SPEC §6.2). Never chain-of-thought: only the `summary` bubble text
 * the agent protocol emits (max 120 chars). Fades between updates, announced
 * politely to screen readers.
 */
"use client";

import { AnimatePresence, motion } from "framer-motion";

export interface ThinkingBubbleProps {
  /** User-safe summary text (already truncated server-side to ≤120 chars). */
  summary: string;
  className?: string;
}

const MAX_LEN = 120;

export function ThinkingBubble({ summary, className }: ThinkingBubbleProps) {
  const text = summary.length > MAX_LEN ? `${summary.slice(0, MAX_LEN - 1)}…` : summary;
  if (!text) return null;
  return (
    <span aria-live="polite" className={className}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={text}
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -2 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-ink-700 bg-ink-850 px-2 py-0.5 text-xs text-stone-400"
        >
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-copper-500" aria-hidden />
          <span className="truncate">{text}</span>
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
