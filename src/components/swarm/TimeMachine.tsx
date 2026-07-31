/**
 * TimeMachine — the Swarm Time Machine (SPEC §6.2 flagship).
 *
 * Loads the run's full event log, scrubs a playhead through it, and folds
 * the event prefix into state-at-time: agents present, tasks by status,
 * files touched, cost accumulation sparkline, recruitment/removal markers.
 * "Fork from here" branches the run (nearest checkpoint at the playhead)
 * with an optional instruction/model override. Branch compare shows two
 * runs side-by-side. Keyboard: ←/→ scrub, space play/pause.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Input,
  SegmentedControl,
  Skeleton,
  toast,
} from "@/components/ui";
import { get, post, ApiError } from "@/lib/api";
import { clsx, timeAgo, tokens, usd } from "@/lib/format";
import { GitFork, Pause, Play } from "lucide-react";
import type { AgentStatus, SwarmEvent, TaskStatus } from "@/types";
import {
  AGENT_STATUS_META,
  CATEGORY_TONE,
  eventCategory,
  parseJsonField,
  RUN_STATUS_META,
  TASK_STATUS_META,
  type CheckpointDto,
  type RunDetailDto,
} from "@/components/swarm/shared";
import { foldEventInto, type RunFold } from "@/lib/stores";

// ── Fold helpers ─────────────────────────────────────────────

function foldPrefix(events: SwarmEvent[], count: number): RunFold {
  const fold: RunFold = {
    status: "queued",
    goal: "",
    plan: null,
    agents: new Map(),
    tasks: new Map(),
    costUsd: 0,
    tokensUsed: 0,
    lastSeq: 0,
  };
  for (let i = 0; i < count && i < events.length; i++) foldEventInto(fold, events[i]);
  return fold;
}

interface FileTouch {
  path: string;
  versions: number;
  agentId: string | null;
  lastSeq: number;
}

function filesTouched(events: SwarmEvent[], count: number): FileTouch[] {
  const map = new Map<string, FileTouch>();
  for (let i = 0; i < count && i < events.length; i++) {
    const e = events[i];
    if (e.type !== "FILE_CREATED" && e.type !== "FILE_UPDATED") continue;
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const path = (p.path as string) ?? "";
    if (!path) continue;
    const cur = map.get(path);
    if (cur) {
      cur.versions += 1;
      cur.agentId = (p.agentId as string) ?? e.actorId ?? cur.agentId;
      cur.lastSeq = e.seq;
    } else {
      map.set(path, {
        path,
        versions: 1,
        agentId: (p.agentId as string) ?? e.actorId ?? null,
        lastSeq: e.seq,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** Cumulative cost per event index (for the sparkline). */
function costSeries(events: SwarmEvent[]): number[] {
  const out: number[] = [0];
  let acc = 0;
  for (const e of events) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    if (typeof p.costUsd === "number") acc += p.costUsd;
    out.push(acc);
  }
  return out;
}

const TASK_COLUMNS: TaskStatus[] = ["pending", "blocked", "active", "completed", "failed"];
const SPEEDS = ["0.5", "1", "2", "4"];

// ── Component ────────────────────────────────────────────────

export interface TimeMachineProps {
  runId: string;
  /** Compact layout for embedding in the run workspace tab. */
  embedded?: boolean;
  /** Explicit run id to compare against (else inferred from run detail). */
  compareRunId?: string;
  className?: string;
}

export function TimeMachine({ runId, embedded = false, compareRunId, className }: TimeMachineProps) {
  const router = useRouter();
  const [events, setEvents] = useState<SwarmEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState("1");
  const [forkOpen, setForkOpen] = useState(false);
  const [forkInstruction, setForkInstruction] = useState("");
  const [forkProvider, setForkProvider] = useState("");
  const [forkModel, setForkModel] = useState("");
  const [forking, setForking] = useState(false);
  const [checkpoints, setCheckpoints] = useState<CheckpointDto[]>([]);
  const [detail, setDetail] = useState<RunDetailDto | null>(null);
  const [compareDetail, setCompareDetail] = useState<RunDetailDto | null>(null);
  const [compareFiles, setCompareFiles] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // ── Load event log + run detail + checkpoints ──────────────
  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    setError(null);
    setCount(0);
    setPlaying(false);
    (async () => {
      try {
        const [evs, det, cps] = await Promise.all([
          get<SwarmEvent[] | { events: SwarmEvent[] }>(
            `/api/runs/${encodeURIComponent(runId)}/events-list?limit=2000`
          ),
          get<RunDetailDto>(`/api/runs/${encodeURIComponent(runId)}`).catch(() => null),
          get<CheckpointDto[] | { checkpoints: CheckpointDto[] }>(
            `/api/runs/${encodeURIComponent(runId)}/checkpoints`
          ).catch(() => [] as CheckpointDto[]),
        ]);
        if (cancelled) return;
        const list = Array.isArray(evs) ? evs : evs.events ?? [];
        list.sort((a, b) => a.seq - b.seq);
        setEvents(list);
        setCount(list.length);
        setDetail(det);
        setCheckpoints(Array.isArray(cps) ? cps : cps.checkpoints ?? []);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof ApiError ? err.message : "Failed to load events");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  // ── Branch compare target ──────────────────────────────────
  const compareId =
    compareRunId ?? detail?.run.branchOfId ?? detail?.forks?.[0]?.id ?? null;
  useEffect(() => {
    if (!compareId || compareId === runId) return;
    let cancelled = false;
    (async () => {
      try {
        const det = await get<RunDetailDto>(`/api/runs/${encodeURIComponent(compareId)}`);
        if (cancelled) return;
        setCompareDetail(det);
        const evs = await get<SwarmEvent[] | { events: SwarmEvent[] }>(
          `/api/runs/${encodeURIComponent(compareId)}/events-list?limit=2000`
        ).catch(() => [] as SwarmEvent[]);
        if (cancelled) return;
        const list = Array.isArray(evs) ? evs : evs.events ?? [];
        const paths = new Set<string>();
        for (const e of list) {
          if (e.type === "FILE_CREATED" || e.type === "FILE_UPDATED") {
            const p = (e.payload ?? {}) as Record<string, unknown>;
            if (typeof p.path === "string") paths.add(p.path);
          }
        }
        setCompareFiles(paths.size);
      } catch {
        /* compare is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [compareId, runId]);

  // ── Derived state-at-time ──────────────────────────────────
  const fold = useMemo(() => (events ? foldPrefix(events, count) : null), [events, count]);
  const files = useMemo(() => (events ? filesTouched(events, count) : []), [events, count]);
  const series = useMemo(() => (events ? costSeries(events) : [0]), [events]);
  const markers = useMemo(() => {
    if (!events || events.length === 0) return [];
    return events
      .map((e, i) => ({ e, i: i + 1 }))
      .filter(({ e }) => e.type === "AGENT_RECRUITED" || e.type === "AGENT_REMOVED")
      .map(({ e, i }) => ({
        i,
        kind: e.type === "AGENT_RECRUITED" ? ("recruit" as const) : ("remove" as const),
        label: e.summary,
      }));
  }, [events]);

  const currentEvent = events && count > 0 ? events[count - 1] : null;

  // ── Playback ───────────────────────────────────────────────
  useEffect(() => {
    if (!playing || !events) return;
    const ms = 500 / Number(speed);
    const timer = setInterval(() => {
      setCount((c) => {
        if (c >= events.length) {
          setPlaying(false);
          return c;
        }
        return c + 1;
      });
    }, ms);
    return () => clearInterval(timer);
  }, [playing, speed, events]);

  const scrub = useCallback(
    (delta: number) => {
      if (!events) return;
      setPlaying(false);
      setCount((c) => Math.max(0, Math.min(events.length, c + delta)));
    },
    [events]
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      scrub(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      scrub(1);
    } else if (e.key === " ") {
      e.preventDefault();
      setPlaying((p) => !p);
    }
  };

  // ── Fork ───────────────────────────────────────────────────
  const fork = async () => {
    setForking(true);
    try {
      // Fork from the nearest checkpoint at/before the playhead so the new
      // run branches from the scrubbed point in time.
      const currentSeq = currentEvent?.seq ?? 0;
      const atPlayhead = checkpoints
        .filter((c) => c.eventSeq <= currentSeq)
        .sort((a, b) => b.eventSeq - a.eventSeq)[0];
      const body: Record<string, unknown> = {};
      if (atPlayhead) body.checkpointId = atPlayhead.id;
      if (forkInstruction.trim()) body.instructionOverride = forkInstruction.trim();
      if (forkProvider.trim() && forkModel.trim())
        body.forceModel = { provider: forkProvider.trim(), model: forkModel.trim() };
      const res = await post<{ runId: string }>(
        `/api/runs/${encodeURIComponent(runId)}/fork`,
        body
      );
      toast("Run forked", "success");
      setForkOpen(false);
      router.push(`/app/runs/${res.runId}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Fork failed", "error");
    } finally {
      setForking(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────
  if (error) {
    return (
      <div className="rounded-md border border-ember-500/40 bg-ink-900 p-4 text-sm text-ember-400" role="alert">
        {error}
      </div>
    );
  }
  if (!events || !fold) {
    return (
      <div className="space-y-2" aria-label="Loading time machine">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (events.length === 0) {
    return <EmptyState title="No events yet" hint="The run has not emitted any events to scrub through." />;
  }

  const statusMeta = RUN_STATUS_META[fold.status];
  const maxCost = Math.max(...series, 0.0001);
  const thisFiles = files.length;

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      role="region"
      aria-label="Time machine — use left and right arrow keys to scrub, space to play or pause"
      onKeyDown={onKeyDown}
      className={clsx(
        "flex min-h-0 flex-col gap-3 outline-none focus-visible:ring-1 focus-visible:ring-copper-500",
        className
      )}
    >
      {/* Scrubber */}
      <div className="rounded-md border border-ink-700 bg-ink-900 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause playback" : "Play events"}
          >
            {playing ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
            {playing ? "Pause" : "Play"}
          </Button>
          <SegmentedControl
            options={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))}
            value={speed}
            onChange={setSpeed}
          />
          <span className="text-xs text-stone-500" aria-live="polite">
            event {count} / {events.length}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Badge tone={statusMeta.tone}>
              <statusMeta.icon className="mr-1 h-3 w-3" aria-hidden />
              {statusMeta.label}
            </Badge>
            <Button size="sm" variant="secondary" onClick={() => setForkOpen(true)}>
              <GitFork className="mr-1 h-3.5 w-3.5" aria-hidden />
              Fork from here
            </Button>
          </div>
        </div>

        {/* Range + markers */}
        <div className="relative">
          <input
            type="range"
            min={0}
            max={events.length}
            value={count}
            onChange={(e) => {
              setPlaying(false);
              setCount(Number(e.target.value));
            }}
            aria-label="Scrub through events"
            className="w-full accent-copper-500"
          />
          <div className="pointer-events-none relative h-2" aria-hidden>
            {markers.map((m) => (
              <span
                key={`${m.i}-${m.kind}`}
                title={m.label}
                className={clsx(
                  "absolute top-0 h-2 w-0.5",
                  m.kind === "recruit" ? "bg-sage-500" : "bg-ember-500"
                )}
                style={{ left: `${(m.i / events.length) * 100}%` }}
              />
            ))}
          </div>
        </div>

        {/* Cost sparkline */}
        <div className="mt-2 flex items-center gap-3">
          <svg
            viewBox="0 0 200 32"
            preserveAspectRatio="none"
            className="h-8 flex-1 rounded-md border border-ink-700 bg-ink-950"
            role="img"
            aria-label={`Cost accumulation, ${usd(series[count] ?? 0)} at playhead`}
          >
            <polyline
              fill="none"
              stroke="#c97c43"
              strokeWidth="1.5"
              points={series
                .map(
                  (v, i) =>
                    `${(i / Math.max(1, series.length - 1)) * 200},${30 - (v / maxCost) * 26}`
                )
                .join(" ")}
            />
            <line
              x1={(count / Math.max(1, series.length - 1)) * 200}
              y1={0}
              x2={(count / Math.max(1, series.length - 1)) * 200}
              y2={32}
              stroke="#a8a29e"
              strokeWidth="1"
            />
          </svg>
          <div className="shrink-0 text-right">
            <p className="font-mono text-sm text-copper-400">{usd(series[count] ?? 0)}</p>
            <p className="text-[10px] text-stone-500">cost at playhead</p>
          </div>
        </div>
      </div>

      {/* Current event + state-at-time */}
      <div className={clsx("grid min-h-0 gap-3", embedded ? "grid-cols-1" : "lg:grid-cols-3")}>
        {/* Current event card */}
        <section
          aria-label="Current event"
          className="rounded-md border border-ink-700 bg-ink-900 p-3"
        >
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
            Current event
          </h3>
          {currentEvent ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge tone={CATEGORY_TONE[eventCategory(currentEvent.type)]} className="font-mono text-[10px]">
                  {currentEvent.type}
                </Badge>
                <span className="font-mono text-[10px] text-stone-500">#{currentEvent.seq}</span>
              </div>
              <p className="text-sm text-stone-200">{currentEvent.summary || "(no summary)"}</p>
              <p className="text-xs text-stone-500">
                <time dateTime={currentEvent.createdAt}>
                  {new Date(currentEvent.createdAt).toLocaleString()}
                </time>{" "}
                · {timeAgo(currentEvent.createdAt)}
              </p>
              <details>
                <summary className="cursor-pointer text-xs text-stone-400 hover:text-stone-200">
                  Payload
                </summary>
                <pre className="mt-1 max-h-40 overflow-auto rounded-md border border-ink-700 bg-ink-950 p-2 font-mono text-xs text-stone-400">
                  {JSON.stringify(currentEvent.payload, null, 2)}
                </pre>
              </details>
            </div>
          ) : (
            <p className="text-sm text-stone-500">Before the first event.</p>
          )}
        </section>

        {/* Agents at playhead */}
        <section
          aria-label="Agents at this point"
          className="rounded-md border border-ink-700 bg-ink-900 p-3"
        >
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
            Agents ({fold.agents.size})
          </h3>
          {fold.agents.size === 0 ? (
            <p className="text-sm text-stone-500">No agents yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {[...fold.agents.values()].map((a) => {
                const meta = AGENT_STATUS_META[a.status as AgentStatus] ?? AGENT_STATUS_META.idle;
                return (
                  <li key={a.id}>
                    <Badge tone={meta.tone}>
                      <meta.icon className="mr-1 h-3 w-3" aria-hidden />
                      {a.name}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
          <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-stone-400">
            Tasks by status
          </h3>
          {fold.tasks.size === 0 ? (
            <p className="text-sm text-stone-500">No tasks yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {TASK_COLUMNS.map((s) => {
                const n = [...fold.tasks.values()].filter((t) => t.status === s).length;
                const total = Math.max(1, fold.tasks.size);
                const meta = TASK_STATUS_META[s];
                return (
                  <li key={s} className="flex items-center gap-2 text-xs">
                    <span className="w-16 shrink-0 text-stone-400">{meta.label}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-800">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${(n / total) * 100}%`, background: meta.hex }}
                      />
                    </span>
                    <span className="w-6 shrink-0 text-right font-mono text-stone-300">{n}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-xs text-stone-500">
            tokens used: <span className="font-mono text-stone-300">{tokens(fold.tokensUsed)}</span>
          </p>
        </section>

        {/* Files touched */}
        <section
          aria-label="Files touched up to this point"
          className="rounded-md border border-ink-700 bg-ink-900 p-3"
        >
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
            Files touched ({files.length})
          </h3>
          {files.length === 0 ? (
            <p className="text-sm text-stone-500">No files written yet.</p>
          ) : (
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {files.map((f) => (
                <li key={f.path} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate font-mono text-stone-300">{f.path}</span>
                  <span className="shrink-0 text-stone-500">
                    v{f.versions}
                    {f.agentId ? ` · ${fold.agents.get(f.agentId)?.name ?? "agent"}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Branch compare */}
      {compareId && (
        <section
          aria-label="Branch compare"
          className="rounded-md border border-ink-700 bg-ink-900 p-3"
        >
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
            Branch compare
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-700 text-left text-xs uppercase tracking-wide text-stone-500">
                  <th className="py-1.5 pr-3 font-medium">Branch</th>
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                  <th className="py-1.5 pr-3 font-medium">Tasks done</th>
                  <th className="py-1.5 pr-3 font-medium">Cost</th>
                  <th className="py-1.5 font-medium">Files</th>
                </tr>
              </thead>
              <tbody>
                <CompareRow
                  label="This run"
                  runId={runId}
                  detail={detail}
                  files={thisFiles}
                  onOpen={() => router.push(`/app/runs/${runId}`)}
                />
                <CompareRow
                  label={detail?.run.branchOfId === compareId ? "Parent run" : "Fork"}
                  runId={compareId}
                  detail={compareDetail}
                  files={compareFiles}
                  onOpen={() => router.push(`/app/runs/${compareId}`)}
                />
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Fork dialog */}
      <Dialog open={forkOpen} onClose={() => setForkOpen(false)} title="Fork run from here" wide>
        <div className="space-y-3">
          <p className="text-sm text-stone-400">
            Branches this run at event #{currentEvent?.seq ?? 0}
            {checkpoints.length > 0
              ? " (nearest checkpoint at the playhead)."
              : "."}{" "}
            The new run replays history, then continues with your override.
          </p>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stone-300">
              Instruction override (optional)
            </span>
            <textarea
              value={forkInstruction}
              onChange={(e) => setForkInstruction(e.target.value)}
              rows={3}
              placeholder="e.g. Switch the database layer to SQLite and simplify deployment."
              className="w-full rounded-md border border-ink-700 bg-ink-950 p-2 text-sm text-stone-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-stone-300">
                Provider override (optional)
              </span>
              <Input
                value={forkProvider}
                onChange={(e) => setForkProvider(e.target.value)}
                placeholder="openai"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-stone-300">
                Model override (optional)
              </span>
              <Input
                value={forkModel}
                onChange={(e) => setForkModel(e.target.value)}
                placeholder="gpt-4o"
              />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setForkOpen(false)} disabled={forking}>
              Cancel
            </Button>
            <Button onClick={() => void fork()} loading={forking}>
              <GitFork className="mr-1 h-4 w-4" aria-hidden />
              Fork run
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function CompareRow({
  label,
  runId,
  detail,
  files,
  onOpen,
}: {
  label: string;
  runId: string;
  detail: RunDetailDto | null;
  files: number | null;
  onOpen: () => void;
}) {
  const status = detail?.run.status;
  const meta = status ? RUN_STATUS_META[status] : null;
  const tasksDone = detail
    ? detail.tasks.filter((t) => t.status === "completed").length
    : null;
  return (
    <tr className="border-b border-ink-700/50 last:border-b-0">
      <td className="py-1.5 pr-3">
        <button
          type="button"
          onClick={onOpen}
          className="text-copper-400 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
        >
          {label}
        </button>
        <span className="ml-2 font-mono text-[10px] text-stone-600">{runId.slice(0, 8)}</span>
      </td>
      <td className="py-1.5 pr-3">
        {meta ? (
          <Badge tone={meta.tone}>
            <meta.icon className="mr-1 h-3 w-3" aria-hidden />
            {meta.label}
          </Badge>
        ) : (
          <span className="text-stone-600">…</span>
        )}
      </td>
      <td className="py-1.5 pr-3 font-mono text-stone-300">
        {tasksDone !== null && detail ? `${tasksDone} / ${detail.tasks.length}` : "…"}
      </td>
      <td className="py-1.5 pr-3 font-mono text-stone-300">
        {detail ? usd(detail.run.costUsd) : "…"}
      </td>
      <td className="py-1.5 font-mono text-stone-300">{files ?? "…"}</td>
    </tr>
  );
}
