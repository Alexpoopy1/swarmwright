"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { clsx } from "@/lib/format";

export type ToastTone = "info" | "success" | "error";

interface ToastItem {
  id: number;
  msg: string;
  tone: ToastTone;
}

type Listener = (t: ToastItem) => void;

const listeners = new Set<Listener>();
let nextId = 1;

/** Fire a toast from anywhere (no store needed). */
export function toast(msg: string, tone: ToastTone = "info") {
  const item: ToastItem = { id: nextId++, msg, tone };
  listeners.forEach((l) => l(item));
}

const TONE_STYLE: Record<ToastTone, string> = {
  info: "border-ink-600 text-stone-200",
  success: "border-sage-500/50 text-sage-400",
  error: "border-ember-500/50 text-ember-400",
};

function ToneIcon({ tone }: { tone: ToastTone }) {
  if (tone === "success") return <CheckCircle2 size={15} aria-hidden />;
  if (tone === "error") return <AlertTriangle size={15} aria-hidden />;
  return <Info size={15} aria-hidden />;
}

export function Toaster() {
  const [items, setItems] = React.useState<ToastItem[]>([]);

  React.useEffect(() => {
    const listener: Listener = (item) => {
      setItems((prev) => [...prev.slice(-4), item]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== item.id));
      }, 4500);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-80 flex-col gap-2"
    >
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className={clsx(
              "pointer-events-auto flex items-start gap-2 rounded-md border bg-ink-900 px-3 py-2.5 text-sm shadow-xl",
              TONE_STYLE[t.tone]
            )}
          >
            <span className="mt-0.5 shrink-0">
              <ToneIcon tone={t.tone} />
            </span>
            <span className="flex-1 text-stone-200">{t.msg}</span>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
              className="shrink-0 rounded text-stone-500 hover:text-stone-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
