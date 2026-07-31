/**
 * EventStream — the run's append-only event log (SPEC §6.2 bottom panel).
 * Windowed rendering (last 200 events + "load earlier"), category
 * multi-select filter + text search, expandable pretty-JSON payloads.
 */
"use client";

import { useMemo, useState } from "react";
import { Badge, EmptyState, Input } from "@/components/ui";
import { timeAgo, clsx } from "@/lib/format";
import type { SwarmEvent } from "@/types";
import {
  CATEGORY_TONE,
  EVENT_CATEGORIES,
  eventCategory,
  type EventCategory,
} from "@/components/swarm/shared";

const PAGE = 200;

export interface EventStreamProps {
  events: SwarmEvent[];
  className?: string;
}

export function EventStream({ events, className }: EventStreamProps) {
  const [windowSize, setWindowSize] = useState(PAGE);
  const [categories, setCategories] = useState<Set<EventCategory>>(new Set());
  const [query, setQuery] = useState("");

  const toggleCategory = (c: EventCategory) => {
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((e) => {
      if (categories.size > 0 && !categories.has(eventCategory(e.type))) return false;
      if (
        q &&
        !e.type.toLowerCase().includes(q) &&
        !e.summary.toLowerCase().includes(q) &&
        !(e.actorId ?? "").toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [events, categories, query]);

  const visible = filtered.slice(-windowSize);
  const hiddenCount = filtered.length - visible.length;

  return (
    <div className={clsx("flex min-h-0 flex-col gap-2", className)}>
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex flex-wrap items-center gap-1"
          role="group"
          aria-label="Filter events by category"
        >
          {EVENT_CATEGORIES.map((c) => {
            const on = categories.has(c);
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() => toggleCategory(c)}
                className={clsx(
                  "rounded-md border px-2 py-0.5 text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500",
                  on
                    ? "border-copper-600 bg-ink-800 text-copper-300"
                    : "border-ink-700 bg-ink-900 text-stone-400 hover:text-stone-200"
                )}
              >
                {c}
              </button>
            );
          })}
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search events…"
          aria-label="Search events"
          className="ml-auto w-48"
        />
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState
          title="No events"
          hint={events.length === 0 ? "Events will appear here as the run progresses." : "No events match the current filters."}
        />
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto rounded-md border border-ink-700 bg-ink-900" aria-label="Run events">
          {hiddenCount > 0 && (
            <li className="border-b border-ink-700 p-1.5 text-center">
              <button
                type="button"
                onClick={() => setWindowSize((w) => w + PAGE)}
                className="text-xs text-copper-400 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
              >
                Load earlier ({hiddenCount} hidden)
              </button>
            </li>
          )}
          {visible.map((e) => (
            <EventRow key={e.seq} event={e} />
          ))}
        </ul>
      )}
    </div>
  );
}

function EventRow({ event }: { event: SwarmEvent }) {
  const category = eventCategory(event.type);
  const hasPayload =
    event.payload != null &&
    typeof event.payload === "object" &&
    Object.keys(event.payload as Record<string, unknown>).length > 0;

  return (
    <li className="border-b border-ink-700/60 last:border-b-0">
      <details className="group">
        <summary
          className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-sm hover:bg-ink-850 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500 [&::-webkit-details-marker]:hidden"
        >
          <Badge tone={CATEGORY_TONE[category]} className="shrink-0 font-mono text-[10px]">
            {event.type}
          </Badge>
          <span className="min-w-0 flex-1 truncate text-stone-300">
            {event.summary || <span className="text-stone-500">(no summary)</span>}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-stone-500">#{event.seq}</span>
          <time
            dateTime={event.createdAt}
            title={new Date(event.createdAt).toLocaleString()}
            className="shrink-0 text-xs text-stone-500"
          >
            {timeAgo(event.createdAt)}
          </time>
        </summary>
        {hasPayload && (
          <pre className="mx-3 mb-2 max-h-64 overflow-auto rounded-md border border-ink-700 bg-ink-950 p-2 font-mono text-xs text-stone-400">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        )}
      </details>
    </li>
  );
}
