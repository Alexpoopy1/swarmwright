"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { clsx } from "@/lib/format";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  open,
  onClose,
  title,
  wide,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Initial focus: first focusable element, else the panel itself.
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      // Focus trap
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
        >
          <div
            className="absolute inset-0 bg-black/60"
            aria-hidden
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title ?? "Dialog"}
            tabIndex={-1}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className={clsx(
              "relative max-h-[85vh] w-full overflow-y-auto rounded-md border border-ink-700 bg-ink-900 p-5 shadow-2xl",
              "focus-visible:outline-none",
              wide ? "max-w-3xl" : "max-w-md"
            )}
          >
            <div className="mb-4 flex items-center justify-between">
              {title ? (
                <h2 className="text-base font-semibold text-stone-100">{title}</h2>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="rounded-md p-1 text-stone-400 transition-colors hover:bg-ink-800 hover:text-stone-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
              >
                <X size={16} />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
