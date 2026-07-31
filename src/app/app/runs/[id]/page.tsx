/**
 * /app/runs/[id] — the agentic workspace (SPEC §6.2).
 *
 * Live SSE fold (connectRunEvents → useRunStore) over ResizablePanels:
 * main tabs (Plan | Board | Swarm | Timeline), right inspector (global
 * controls, budget bars, active agents with orbs + thinking bubbles,
 * selected agent detail, approvals), bottom panel (Events | Messages |
 * Tool calls | Files). Failed/stopped runs show an error banner.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ExternalLink,
  GitBranch,
  GitFork,
  Pause,
  Play,
  Square,
} from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Input,
  ResizablePanels,
  Skeleton,
  Tabs,
  Toggle,
  Tooltip,
  toast,
} from "@/components/ui";
import { get, post, ApiError } from "@/lib/api";
import { clsx, durationMs, timeAgo, tokens as fmtTokens, usd } from "@/lib/format";
import type { SwarmEvent } from "@/types";
import { connectRunEvents } from "@/lib/sse";
import { useRunStore, useUiStore } from "@/lib/stores";
import {
  AGENT_STATUS_META,
  CATEGORY_TONE,
  RUN_STATUS_META,
  eventCategory,
  type AgentDto,
  type RunDetailDto,
} from "@/components/swarm/shared";
import { AgentOrb } from "@/components/swarm/AgentOrb";
import { ThinkingBubble } from "@/components/swarm/ThinkingBubble";
import { SwarmGraph } from "@/components/swarm/SwarmGraph";
import { EventStream } from "@/components/swarm/EventStream";
import { ApprovalsPanel } from "@/components/swarm/ApprovalsPanel";
import { TaskBoard } from "@/components/swarm/TaskBoard";
import { PlanView } from "@/components/swarm/PlanView";
import { TimeMachine } from "@/components/swarm/TimeMachine";

function errMsg(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export default function RunWorkspacePage() {
  const params = useParams<{ id: string }>();
  const runId = params.id;
  const router = useRouter();

  const [detail, setDetail] = useState<RunDetailDto | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [forkOpen, setForkOpen] = useState(false);
  const [forkInstruction, setForkInstruction] = useState("");
  const [controlBusy, setControlBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const events = useRunStore((s) => s.events);
  const foldStatus = useRunStore((s) => s.status);
  const costUsd = useRunStore((s) => s.costUsd);
  const tokensUsed = useRunStore((s) => s.tokensUsed);
  const agents = useRunStore((s) => s.agents);
  const streamError = useRunStore((s) => s.streamError);
  const activeTab = useUiStore((s) => s.activeTab);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const selectedAgentId = useUiStore((s) => s.selectedAgentId);
  const effectsEnabled = useUiStore((s) => s.effectsEnabled);
  const setEffectsEnabled = useUiStore((s) => s.setEffectsEnabled);

  const loadDetail = useCallback(async () => {
    try {
      const d = await get<RunDetailDto>(`/api/runs/${encodeURIComponent(runId)}`);
      setDetail(d);
      setDetailError(null);
    } catch (err) {
      setDetailError(errMsg(err, "Failed to load run"));
    }
  }, [runId]);

  // ── Wire the live fold: snapshot replay → SSE from last seq ──
  useEffect(() => {
    const store = useRunStore.getState();
    store.reset(runId);
    let closed = false;
    let conn: { close: () => void } | null = null;
    let detailTimer: ReturnType<typeof setTimeout> | null = null;

    // Detail refetch (debounced) when structural events arrive.
    const scheduleDetailRefetch = () => {
      if (detailTimer) clearTimeout(detailTimer);
      detailTimer = setTimeout(() => void loadDetail(), 800);
    };

    (async () => {
      try {
        const [det, evs] = await Promise.all([
          get<RunDetailDto>(`/api/runs/${encodeURIComponent(runId)}`),
          get<SwarmEvent[] | { events: SwarmEvent[] }>(
            `/api/runs/${encodeURIComponent(runId)}/events-list?limit=2000`
          ).catch(() => [] as SwarmEvent[]),
        ]);
        if (closed) return;
        setDetail(det);
        const list = Array.isArray(evs) ? evs : evs.events ?? [];
        useRunStore.getState().setInitial(runId, list);
        conn = connectRunEvents(runId, {
          afterSeq: useRunStore.getState().lastSeq,
          onEvent: (e) => {
            useRunStore.getState().applyEvent(e);
            if (
              e.type.startsWith("APPROVAL_") ||
              e.type.startsWith("PLAN_") ||
              e.type.startsWith("RUN_")
            ) {
              scheduleDetailRefetch();
            }
          },
          onError: (err, info) => {
            if (info.final) useRunStore.getState().setStreamError(err.message);
          },
        });
      } catch (err) {
        if (!closed) setDetailError(errMsg(err, "Failed to load run"));
      }
    })();

    return () => {
      closed = true;
      conn?.close();
      if (detailTimer) clearTimeout(detailTimer);
    };
  }, [runId, loadDetail]);

  // Elapsed ticker.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const run = detail?.run;
  const status = run?.status ?? foldStatus;
  const statusMeta = RUN_STATUS_META[status] ?? RUN_STATUS_META.queued;
  const isLive = status === "running" || status === "planning" || status === "queued" || status === "awaiting_approval";
  const isPaused = status === "paused";
  const isTerminal = status === "completed" || status === "failed" || status === "stopped";

  const control = async (action: "pause" | "resume" | "stop") => {
    if (action === "stop" && !window.confirm("Stop this run? Agents halt between steps; history is kept.")) {
      return;
    }
    setControlBusy(true);
    try {
      await post(`/api/runs/${encodeURIComponent(runId)}/control`, { action });
      toast(`Run ${action === "stop" ? "stopping" : action + "d"}`, "success");
      void loadDetail();
    } catch (err) {
      toast(errMsg(err, `${action} failed`), "error");
    } finally {
      setControlBusy(false);
    }
  };

  const fork = async () => {
    setControlBusy(true);
    try {
      const res = await post<{ runId: string }>(
        `/api/runs/${encodeURIComponent(runId)}/fork`,
        forkInstruction.trim() ? { instructionOverride: forkInstruction.trim() } : {}
      );
      toast("Run forked", "success");
      setForkOpen(false);
      router.push(`/app/runs/${res.runId}`);
    } catch (err) {
      toast(errMsg(err, "Fork failed"), "error");
    } finally {
      setControlBusy(false);
    }
  };

  const elapsed = useMemo(() => {
    if (!run) return null;
    const start = new Date(run.startedAt ?? run.createdAt).getTime();
    const end = run.endedAt ? new Date(run.endedAt).getTime() : now;
    return durationMs(Math.max(0, end - start));
  }, [run, now]);

  const detailAgents = useMemo(() => {
    const map = new Map<string, AgentDto>();
    for (const a of detail?.agents ?? []) map.set(a.id, a);
    return map;
  }, [detail]);

  const selectedAgent = selectedAgentId ? agents.get(selectedAgentId) : undefined;
  const selectedDetail = selectedAgentId ? detailAgents.get(selectedAgentId) : undefined;

  if (detailError && !detail) {
    return (
      <div className="flex h-full items-center justify-center" role="alert">
        <div className="text-center">
          <p className="text-sm text-ember-400">{detailError}</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => void loadDetail()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // ── Main tabs ──────────────────────────────────────────────
  const mainPanel = (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Tabs
        tabs={[
          { id: "plan", label: "Plan" },
          { id: "board", label: "Board" },
          { id: "swarm", label: "Swarm" },
          { id: "timeline", label: "Timeline" },
        ]}
        active={activeTab}
        onChange={setActiveTab}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === "plan" && (
          <PlanView plan={detail?.plan ?? null} runStatus={status} onChanged={() => void loadDetail()} />
        )}
        {activeTab === "board" && <TaskBoard runId={runId} className="h-full" />}
        {activeTab === "swarm" && <SwarmGraph runId={runId} className="h-full" />}
        {activeTab === "timeline" && <TimeMachine runId={runId} embedded />}
      </div>
    </div>
  );

  // ── Inspector ──────────────────────────────────────────────
  const budget = run?.budgetUsd ?? 0;
  const tokenLimit = run?.tokenLimit ?? 0;
  const liveCost = Math.max(run?.costUsd ?? 0, costUsd);
  const liveTokens = Math.max(run?.tokensUsed ?? 0, tokensUsed);

  const inspector = (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto pr-0.5">
      {/* Global controls */}
      <section aria-label="Run controls" className="rounded-md border border-ink-700 bg-ink-900 p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
          Controls
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {isLive && (
            <Button size="sm" variant="secondary" disabled={controlBusy} onClick={() => void control("pause")}>
              <Pause className="mr-1 h-3.5 w-3.5" aria-hidden />
              Pause
            </Button>
          )}
          {isPaused && (
            <Button size="sm" disabled={controlBusy} onClick={() => void control("resume")}>
              <Play className="mr-1 h-3.5 w-3.5" aria-hidden />
              Resume
            </Button>
          )}
          {!isTerminal && (
            <Button size="sm" variant="danger" disabled={controlBusy} onClick={() => void control("stop")}>
              <Square className="mr-1 h-3.5 w-3.5" aria-hidden />
              Stop
            </Button>
          )}
          <Button size="sm" variant="secondary" disabled={controlBusy} onClick={() => setForkOpen(true)}>
            <GitFork className="mr-1 h-3.5 w-3.5" aria-hidden />
            Fork
          </Button>
        </div>
        <div className="mt-2 border-t border-ink-700 pt-2">
          <Toggle checked={effectsEnabled} onChange={setEffectsEnabled} label="Particle effects" />
        </div>
      </section>

      {/* Budget bars */}
      <section aria-label="Budget usage" className="rounded-md border border-ink-700 bg-ink-900 p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
          Budget
        </h3>
        <BudgetBar label="Cost" value={liveCost} max={budget} format={usd} />
        <BudgetBar label="Tokens" value={liveTokens} max={tokenLimit} format={fmtTokens} />
      </section>

      {/* Active agents */}
      <section aria-label="Agents" className="rounded-md border border-ink-700 bg-ink-900 p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
          Agents ({agents.size})
        </h3>
        {agents.size === 0 ? (
          <p className="text-sm text-stone-500">No agents recruited yet.</p>
        ) : (
          <ul className="space-y-2">
            {[...agents.values()].map((a) => {
              const det = detailAgents.get(a.id);
              const selected = a.id === selectedAgentId;
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => useUiStore.getState().selectAgent(selected ? null : a.id)}
                    aria-pressed={selected}
                    className={clsx(
                      "flex w-full items-center gap-2 rounded-md border p-1.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500",
                      selected ? "border-copper-600 bg-ink-850" : "border-ink-700 hover:border-ink-600"
                    )}
                  >
                    <AgentOrb status={a.status} activity={a.status === "active" ? 0.7 : 0.2} size={48} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm text-stone-200">{a.name}</span>
                        <Badge tone={AGENT_STATUS_META[a.status].tone}>
                          {AGENT_STATUS_META[a.status].label}
                        </Badge>
                      </span>
                      <span className="block truncate text-xs text-stone-500">
                        {a.role}
                        {(det?.provider || a.provider) && ` · ${det?.provider || a.provider}`}
                      </span>
                      <span className="mt-0.5 block">
                        <ThinkingBubble summary={a.summary || det?.summary || ""} />
                      </span>
                      <span className="mt-0.5 block font-mono text-[10px] text-stone-500">
                        {fmtTokens((det?.tokensIn ?? 0) + (det?.tokensOut ?? 0) || a.tokens)} tok ·{" "}
                        {usd(det?.costUsd ?? a.costUsd)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Selected agent detail */}
      {selectedAgent && (
        <section
          aria-label={`Agent ${selectedAgent.name} detail`}
          className="rounded-md border border-copper-700 bg-ink-900 p-3"
        >
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-copper-400">
            Selected agent
          </h3>
          <dl className="space-y-1 text-sm">
            <Row k="Name" v={selectedAgent.name} />
            <Row k="Role" v={selectedAgent.role} />
            <Row k="Provider / model" v={`${selectedAgent.provider || selectedDetail?.provider || "—"} · ${selectedAgent.model || selectedDetail?.model || "—"}`} mono />
            <Row k="Genome" v={selectedAgent.genomeId ?? selectedDetail?.genomeId ?? "none"} mono />
            <Row
              k="Confidence"
              v={`${Math.round((selectedDetail?.confidence ?? selectedAgent.confidence) * 100)}%`}
            />
            <Row k="Cost" v={usd(selectedDetail?.costUsd ?? selectedAgent.costUsd)} mono />
            <Row
              k="Tokens"
              v={fmtTokens(
                (selectedDetail?.tokensIn ?? 0) + (selectedDetail?.tokensOut ?? 0) || selectedAgent.tokens
              )}
              mono
            />
          </dl>
          {(selectedAgent.summary || selectedDetail?.summary) && (
            <p className="mt-2 rounded-md border border-ink-700 bg-ink-850 p-2 text-xs text-stone-400">
              {selectedAgent.summary || selectedDetail?.summary}
            </p>
          )}
        </section>
      )}

      {/* Approvals */}
      <section aria-label="Approvals" className="rounded-md border border-ink-700 bg-ink-900 p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
          Approvals
        </h3>
        <ApprovalsPanel
          runId={runId}
          approvals={detail?.approvals ?? []}
          onResolved={() => void loadDetail()}
        />
      </section>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* Run header */}
      <header className="flex flex-wrap items-center gap-2 rounded-md border border-ink-700 bg-ink-900 px-3 py-2">
        <Link
          href="/app/runs"
          className="text-xs text-stone-500 hover:text-stone-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
        >
          ← Runs
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-stone-100" title={run?.goal}>
          {run?.goal ?? "Loading run…"}
        </h1>
        {run?.branchOfId && (
          <Tooltip content={`Branched from run ${run.branchOfId.slice(0, 8)}`}>
            <Badge tone="stone">
              <GitBranch className="mr-1 h-3 w-3" aria-hidden />
              branch
            </Badge>
          </Tooltip>
        )}
        <Badge tone={statusMeta.tone}>
          <statusMeta.icon className="mr-1 h-3 w-3" aria-hidden />
          {statusMeta.label}
        </Badge>
        {elapsed && <span className="font-mono text-xs text-stone-500">{elapsed}</span>}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => router.push(`/app/runs/${runId}/timemachine`)}
          aria-label="Open full time machine"
        >
          <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden />
          Time Machine
        </Button>
      </header>

      {/* Failure / stop banner */}
      {(status === "failed" || status === "stopped") && (
        <div
          role="alert"
          className="rounded-md border border-ember-500/50 bg-ink-900 px-3 py-2 text-sm text-ember-400"
        >
          {status === "failed" ? "Run failed" : "Run stopped"}
          {run?.error ? `: ${run.error}` : "."} You can fork the run from any point in the Time
          Machine to continue with a different instruction.
        </div>
      )}
      {streamError && isLive && (
        <div role="alert" className="rounded-md border border-amber-500/40 bg-ink-900 px-3 py-1.5 text-xs text-stone-400">
          Live stream disconnected ({streamError}).{" "}
          <button
            type="button"
            className="text-copper-400 underline-offset-2 hover:underline"
            onClick={() => router.refresh()}
          >
            Reload to reconnect
          </button>
        </div>
      )}

      {!detail ? (
        <div className="grid min-h-0 flex-1 grid-cols-3 gap-3">
          <Skeleton className="col-span-2 h-full" />
          <Skeleton className="h-full" />
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1">
            <ResizablePanels
              left={mainPanel}
              right={inspector}
              defaultRatio={0.68}
              minRatio={0.35}
              storageKey={`sw.run.panels`}
            />
          </div>
          <BottomPanel events={events} />
        </>
      )}

      {/* Fork dialog */}
      <Dialog open={forkOpen} onClose={() => setForkOpen(false)} title="Fork run">
        <div className="space-y-3">
          <p className="text-sm text-stone-400">
            Branch this run from its latest checkpoint. Add an instruction override to steer the
            copy.
          </p>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stone-300">
              Instruction override (optional)
            </span>
            <Input
              value={forkInstruction}
              onChange={(e) => setForkInstruction(e.target.value)}
              placeholder="e.g. Use Postgres instead of SQLite"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setForkOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void fork()} loading={controlBusy}>
              <GitFork className="mr-1 h-4 w-4" aria-hidden />
              Fork run
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

// ── Inspector helpers ────────────────────────────────────────

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-xs text-stone-500">{k}</dt>
      <dd className={clsx("truncate text-stone-300", mono && "font-mono text-xs")}>{v}</dd>
    </div>
  );
}

function BudgetBar({
  label,
  value,
  max,
  format,
}: {
  label: string;
  value: number;
  max: number;
  format: (n: number) => string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="mb-2 last:mb-0">
      <div className="mb-0.5 flex items-baseline justify-between text-xs">
        <span className="text-stone-400">{label}</span>
        <span className="font-mono text-stone-300">
          {format(value)} / {max > 0 ? format(max) : "∞"}
        </span>
      </div>
      <span
        className="block h-1.5 overflow-hidden rounded-full bg-ink-800"
        role="progressbar"
        aria-label={`${label}: ${format(value)} of ${max > 0 ? format(max) : "unlimited"}`}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
      >
        <span
          className={clsx("block h-full rounded-full", pct > 85 ? "bg-ember-500" : "bg-copper-500")}
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  );
}

// ── Bottom panel (Events | Messages | Tool calls | Files) ────

function BottomPanel({ events }: { events: SwarmEvent[] }) {
  const [tab, setTab] = useState("events");
  const [open, setOpen] = useState(true);

  const messages = useMemo(() => events.filter((e) => e.type === "AGENT_MESSAGE"), [events]);
  const toolEvents = useMemo(
    () => events.filter((e) => e.type.startsWith("TOOL_") || e.type.startsWith("TEST_")),
    [events]
  );
  const fileEvents = useMemo(
    () => events.filter((e) => e.type === "FILE_CREATED" || e.type === "FILE_UPDATED"),
    [events]
  );

  return (
    <section
      aria-label="Run activity"
      className="flex shrink-0 flex-col rounded-md border border-ink-700 bg-ink-900"
    >
      <div className="flex items-center gap-2 border-b border-ink-700 px-2 py-1">
        <Tabs
          tabs={[
            { id: "events", label: `Events (${events.length})` },
            { id: "messages", label: `Messages (${messages.length})` },
            { id: "tools", label: `Tool calls (${toolEvents.length})` },
            { id: "files", label: `Files (${fileEvents.length})` },
          ]}
          active={tab}
          onChange={(id) => {
            setTab(id);
            setOpen(true);
          }}
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="ml-auto text-xs text-stone-500 hover:text-stone-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
        >
          {open ? "Collapse ▾" : "Expand ▴"}
        </button>
      </div>
      {open && (
        <div className="h-56 min-h-0 p-2">
          {tab === "events" && <EventStream events={events} className="h-full" />}
          {tab === "messages" && <AgentMessages events={messages} />}
          {tab === "tools" && <ToolCalls events={toolEvents} />}
          {tab === "files" && <FilesChanged events={fileEvents} />}
        </div>
      )}
    </section>
  );
}

function AgentMessages({ events }: { events: SwarmEvent[] }) {
  if (events.length === 0) {
    return <EmptyState title="No agent messages" hint="Structured inter-agent mail appears here." />;
  }
  return (
    <ul className="grid h-full min-h-0 grid-cols-1 gap-2 overflow-y-auto lg:grid-cols-2" aria-label="Agent messages">
      {[...events].reverse().map((e) => {
        const p = (e.payload ?? {}) as Record<string, unknown>;
        const confidence = typeof p.confidence === "number" ? p.confidence : null;
        const requestedAction = (p.requestedAction as string) || "";
        return (
          <li key={e.seq} className="rounded-md border border-ink-700 bg-ink-850 p-2">
            <div className="flex items-center gap-2 text-xs text-stone-500">
              <span className="font-mono text-copper-400">{(p.fromAgentId as string) ?? e.actorId ?? "agent"}</span>
              <span aria-hidden>→</span>
              <span className="font-mono text-sage-400">{(p.to as string) ?? "?"}</span>
              {confidence !== null && (
                <span className="ml-auto font-mono">{Math.round(confidence * 100)}%</span>
              )}
              <time dateTime={e.createdAt}>{timeAgo(e.createdAt)}</time>
            </div>
            <p className="mt-1 text-sm text-stone-200">{e.summary || (p.summary as string) || "—"}</p>
            {requestedAction && (
              <p className="mt-0.5 text-xs text-stone-500">requested: {requestedAction}</p>
            )}
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-stone-500 hover:text-stone-300">
                Payload
              </summary>
              <pre className="mt-1 max-h-32 overflow-auto rounded-md border border-ink-700 bg-ink-950 p-1.5 font-mono text-[10px] text-stone-400">
                {JSON.stringify(p.payload ?? p, null, 2)}
              </pre>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

function ToolCalls({ events }: { events: SwarmEvent[] }) {
  if (events.length === 0) {
    return <EmptyState title="No tool calls" hint="Tool executions and tests appear here." />;
  }
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ink-700 text-left text-xs uppercase tracking-wide text-stone-500">
            <th className="py-1 pr-2 font-medium">Event</th>
            <th className="py-1 pr-2 font-medium">Tool</th>
            <th className="py-1 pr-2 font-medium">Agent</th>
            <th className="py-1 pr-2 font-medium">Duration</th>
            <th className="py-1 pr-2 font-medium">Summary</th>
            <th className="py-1 font-medium">When</th>
          </tr>
        </thead>
        <tbody>
          {[...events].reverse().map((e) => {
            const p = (e.payload ?? {}) as Record<string, unknown>;
            const tool = (p.toolName as string) ?? (p.name as string) ?? "—";
            return (
              <tr key={e.seq} className="border-b border-ink-700/50 last:border-b-0">
                <td className="py-1 pr-2">
                  <Badge tone={CATEGORY_TONE[eventCategory(e.type)]} className="font-mono text-[10px]">
                    {e.type.replace(/^(TOOL|TEST)_/, "")}
                  </Badge>
                </td>
                <td className="py-1 pr-2 font-mono text-xs text-stone-300">{tool}</td>
                <td className="py-1 pr-2 font-mono text-xs text-stone-500">
                  {(p.agentId as string)?.slice(0, 8) ?? e.actorId?.slice(0, 8) ?? "—"}
                </td>
                <td className="py-1 pr-2 font-mono text-xs text-stone-500">
                  {typeof p.durationMs === "number" ? durationMs(p.durationMs) : "—"}
                </td>
                <td className="max-w-0 truncate py-1 pr-2 text-xs text-stone-400">{e.summary}</td>
                <td className="py-1 text-xs text-stone-500">
                  <time dateTime={e.createdAt}>{timeAgo(e.createdAt)}</time>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FilesChanged({ events }: { events: SwarmEvent[] }) {
  if (events.length === 0) {
    return <EmptyState title="No files changed" hint="Files the swarm writes appear here." />;
  }
  return (
    <ul className="h-full min-h-0 overflow-y-auto" aria-label="Files changed">
      {[...events].reverse().map((e) => {
        const p = (e.payload ?? {}) as Record<string, unknown>;
        return (
          <li
            key={e.seq}
            className="flex items-center gap-2 border-b border-ink-700/50 px-1 py-1 text-sm last:border-b-0"
          >
            <Badge tone={e.type === "FILE_CREATED" ? "sage" : "copper"} className="font-mono text-[10px]">
              {e.type === "FILE_CREATED" ? "created" : "updated"}
            </Badge>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-stone-300">
              {(p.path as string) ?? "—"}
            </span>
            <span className="font-mono text-[10px] text-stone-500">
              {typeof p.version === "number" ? `v${p.version}` : ""}
              {p.agentId ? ` · ${(p.agentId as string).slice(0, 8)}` : e.actorId ? ` · ${e.actorId.slice(0, 8)}` : ""}
            </span>
            <time dateTime={e.createdAt} className="text-xs text-stone-500">
              {timeAgo(e.createdAt)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}
