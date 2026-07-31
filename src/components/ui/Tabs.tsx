"use client";

import { clsx } from "@/lib/format";

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: string; label: string }>;
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-ink-700">
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={clsx(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors duration-150 ease-out",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500",
              selected
                ? "border-copper-500 text-copper-300"
                : "border-transparent text-stone-400 hover:text-stone-200"
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
