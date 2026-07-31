import type { SwarmEvent } from "@/types";

/**
 * In-process pub/sub fanout for SSE streams.
 * Events are always persisted first (see store.ts); the bus only
 * notifies live subscribers. Runs survive refresh because clients
 * replay from the DB with an `afterSeq` cursor before subscribing.
 */
type Listener = (e: SwarmEvent) => void;

const globalBus = globalThis as unknown as {
  __swListeners?: Map<string, Set<Listener>>;
};

function listeners(): Map<string, Set<Listener>> {
  if (!globalBus.__swListeners) globalBus.__swListeners = new Map();
  return globalBus.__swListeners;
}

/** Subscribe to a run's live events. Returns an unsubscribe function. */
export function subscribe(runId: string, listener: Listener): () => void {
  const map = listeners();
  if (!map.has(runId)) map.set(runId, new Set());
  map.get(runId)!.add(listener);
  return () => {
    map.get(runId)?.delete(listener);
    if (map.get(runId)?.size === 0) map.delete(runId);
  };
}

export function publish(event: SwarmEvent): void {
  if (!event.runId) return;
  const set = listeners().get(event.runId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(event);
    } catch {
      // a broken subscriber must not affect others
    }
  }
}
