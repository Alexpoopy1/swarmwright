/** Display formatters for the Swarmwright UI. */

/** $0.0042 — adaptive precision for small amounts. */
export function usd(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  if (n === 0) return "$0.00";
  const abs = Math.abs(n);
  if (abs >= 100) return `$${n.toFixed(2)}`;
  if (abs >= 1) return `$${n.toFixed(2)}`;
  if (abs >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
}

/** 12.4k — compact token counts. */
export function tokens(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) < 1000) return String(Math.round(n));
  if (Math.abs(n) < 1_000_000) {
    const v = n / 1000;
    return `${v >= 100 ? Math.round(v) : v.toFixed(1)}k`;
  }
  const v = n / 1_000_000;
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)}M`;
}

/** 1m 24s — human duration from milliseconds. */
export function durationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSec = Math.floor(ms / 1000);
  const sec = totalSec % 60;
  const min = Math.floor(totalSec / 60) % 60;
  const hr = Math.floor(totalSec / 3600);
  if (hr > 0) return `${hr}h ${min}m`;
  if (min > 0) return `${min}m ${sec}s`;
  return `${sec}s`;
}

/** "3m ago" style relative time. */
export function timeAgo(iso: string | Date): string {
  const then = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  if (!Number.isFinite(then)) return "—";
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** Tiny class-name joiner (no dependency). */
export function clsx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
