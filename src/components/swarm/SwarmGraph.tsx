/**
 * SwarmGraph — d3-force SVG visualization of the live run (SPEC §6.2).
 *
 * Coordinator hexagon at center, agents as status-ringed circles (label =
 * role), tasks as status-filled squares. Edges: task dependencies (thin
 * stone), agent↔task assignment (copper), recent AGENT_MESSAGEs (animated
 * dashed, 3s). Pan (drag background) + zoom (wheel). Click a node to select
 * the agent (useUiStore) and reveal a mini action bar (Pause/Resume/Stop →
 * POST /api/runs/[id]/control). Filters by agent status + provider, and a
 * list-view toggle as a text alternative. Nodes are keyboard-focusable.
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { Badge, Button, EmptyState, Select, Tooltip } from "@/components/ui";
import { post, ApiError } from "@/lib/api";
import { clsx } from "@/lib/format";
import { toast } from "@/components/ui";
import type { AgentStatus, SwarmEvent, TaskStatus } from "@/types";
import {
  AGENT_STATUS_META,
  HEX,
  TASK_STATUS_META,
  type StatusMeta,
} from "@/components/swarm/shared";
import { useRunStore, type FoldedAgent, type FoldedTask } from "@/lib/stores";
import { useUiStore } from "@/lib/stores";

// ── Types ────────────────────────────────────────────────────

type NodeKind = "coordinator" | "agent" | "task";

interface GNode extends SimulationNodeDatum {
  id: string;
  kind: NodeKind;
  label: string;
  sub: string;
  status?: AgentStatus | TaskStatus;
  provider?: string;
  r: number;
}

interface GLink extends SimulationLinkDatum<GNode> {
  kind: "dep" | "assign";
}

const MESSAGE_WINDOW_MS = 3000;

// ── Component ────────────────────────────────────────────────

export interface SwarmGraphProps {
  runId: string;
  className?: string;
}

export function SwarmGraph({ runId, className }: SwarmGraphProps) {
  const agents = useRunStore((s) => s.agents);
  const tasks = useRunStore((s) => s.tasks);
  const events = useRunStore((s) => s.events);
  const selectedAgentId = useUiStore((s) => s.selectedAgentId);
  const selectAgent = useUiStore((s) => s.selectAgent);

  const [statusFilter, setStatusFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");
  const [listView, setListView] = useState(false);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [controlBusy, setControlBusy] = useState(false);
  const [, setNowTick] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; tx: number; ty: number } | null>(null);

  const agentList = useMemo(() => [...agents.values()], [agents]);
  const taskList = useMemo(() => [...tasks.values()], [tasks]);

  const providers = useMemo(
    () => [...new Set(agentList.map((a) => a.provider).filter(Boolean))],
    [agentList]
  );
  const statuses = useMemo(
    () => [...new Set(agentList.map((a) => a.status))],
    [agentList]
  );

  const visibleAgents = useMemo(
    () =>
      agentList.filter(
        (a) =>
          a.status !== "removed" &&
          (statusFilter === "all" || a.status === statusFilter) &&
          (providerFilter === "all" || a.provider === providerFilter)
      ),
    [agentList, statusFilter, providerFilter]
  );

  // ── Graph data ─────────────────────────────────────────────
  const { nodes, links } = useMemo(() => {
    const nodes: GNode[] = [
      {
        id: "__coordinator__",
        kind: "coordinator",
        label: "Coordinator",
        sub: "orchestrator",
        r: 22,
        fx: 0,
        fy: 0,
      },
    ];
    const links: GLink[] = [];
    const agentIds = new Set(visibleAgents.map((a) => a.id));
    for (const a of visibleAgents) {
      nodes.push({
        id: `agent:${a.id}`,
        kind: "agent",
        label: a.name,
        sub: a.role,
        status: a.status,
        provider: a.provider,
        r: 18,
      });
      // Weak structural link keeps agents arranged around the coordinator.
      links.push({ source: "__coordinator__", target: `agent:${a.id}`, kind: "assign" });
    }
    for (const t of taskList) {
      nodes.push({
        id: `task:${t.id}`,
        kind: "task",
        label: t.title,
        sub: t.status,
        status: t.status,
        r: 12,
      });
      if (t.agentId && agentIds.has(t.agentId)) {
        links.push({ source: `agent:${t.agentId}`, target: `task:${t.id}`, kind: "assign" });
      }
      for (const d of t.dependsOn) {
        if (tasks.has(d)) {
          links.push({ source: `task:${d}`, target: `task:${t.id}`, kind: "dep" });
        }
      }
    }
    return { nodes, links };
  }, [visibleAgents, taskList, tasks]);

  // ── Force simulation (tick throttled to ~30fps) ───────────
  useEffect(() => {
    if (nodes.length <= 1) {
      setPositions(new Map());
      return;
    }
    const seeded = nodes.map((n, i) => ({
      ...n,
      x: n.fx ?? Math.cos(i * 2.399963) * (60 + i * 14),
      y: n.fy ?? Math.sin(i * 2.399963) * (60 + i * 14),
    }));
    const sim = forceSimulation<GNode>(seeded)
      .force(
        "link",
        forceLink<GNode, GLink>(links)
          .id((n) => n.id)
          .distance((l) => (l.kind === "dep" ? 90 : 110))
          .strength((l) => (l.kind === "dep" ? 0.4 : 0.15))
      )
      .force("charge", forceManyBody().strength(-180))
      .force("center", forceCenter(0, 0))
      .force(
        "collide",
        forceCollide<GNode>().radius((n) => n.r + 14)
      )
      .alphaDecay(0.03);

    let lastPush = 0;
    sim.on("tick", () => {
      const now = performance.now();
      if (now - lastPush < 33) return; // ~30fps
      lastPush = now;
      setPositions(new Map(seeded.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }])));
    });
    return () => {
      sim.stop();
    };
  }, [nodes, links]);

  // ── Recent message edges (3s window) ──────────────────────
  useEffect(() => {
    const timer = setInterval(() => setNowTick((t) => t + 1), 500);
    return () => clearInterval(timer);
  }, []);
  const messageEdges = useMemo(() => {
    const now = Date.now();
    const out: Array<{ from: string; to: string; key: string }> = [];
    for (const e of events.slice(-60)) {
      if (e.type !== "AGENT_MESSAGE") continue;
      if (now - new Date(e.createdAt).getTime() > MESSAGE_WINDOW_MS) continue;
      const p = (e.payload ?? {}) as Record<string, unknown>;
      const from = (p.fromAgentId as string) ?? e.actorId;
      const toRaw = (p.to as string) ?? "";
      // `to` may be an agent id or a role name (agent protocol).
      const to =
        agents.get(toRaw)?.id ??
        agentList.find((a) => a.role === toRaw || a.name === toRaw)?.id ??
        null;
      if (from && to && agents.has(from) && from !== to) {
        out.push({ from: `agent:${from}`, to: `agent:${to}`, key: `${e.seq}` });
      }
    }
    return out;
  }, [events, agents, agentList]);

  // ── Pan / zoom ─────────────────────────────────────────────
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setTransform((t) => {
        const k = Math.min(3, Math.max(0.3, t.k * (e.deltaY > 0 ? 0.9 : 1.1)));
        return { ...t, k };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest("[data-node]")) return; // node clicks, not pan
    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, tx: transform.x, ty: transform.y };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setTransform((t) => ({ ...t, x: d.tx + (e.clientX - d.startX), y: d.ty + (e.clientY - d.startY) }));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  // ── Agent control (run-level endpoint, agentId carried for routing) ──
  const control = async (action: "pause" | "resume" | "stop", agentId: string) => {
    setControlBusy(true);
    try {
      await post(`/api/runs/${encodeURIComponent(runId)}/control`, { action, agentId });
      toast(`Sent ${action}`, "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : `${action} failed`, "error");
    } finally {
      setControlBusy(false);
    }
  };

  const selectedAgent = selectedAgentId ? agents.get(selectedAgentId) : undefined;
  const posOf = (id: string) => positions.get(id) ?? { x: 0, y: 0 };

  if (agentList.length === 0 && taskList.length === 0) {
    return (
      <EmptyState
        title="Swarm not started"
        hint="Agents and tasks will appear here once the run begins executing."
      />
    );
  }

  return (
    <div className={clsx("flex min-h-0 flex-col gap-2", className)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter agents by status"
        >
          <option value="all">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {AGENT_STATUS_META[s].label}
            </option>
          ))}
        </Select>
        <Select
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
          aria-label="Filter agents by provider"
        >
          <option value="all">All providers</option>
          {providers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <Button size="sm" variant="secondary" onClick={() => setTransform({ x: 0, y: 0, k: 1 })}>
          Reset view
        </Button>
        <Button
          size="sm"
          variant={listView ? "primary" : "secondary"}
          onClick={() => setListView((v) => !v)}
          aria-pressed={listView}
        >
          {listView ? "Graph view" : "List view"}
        </Button>
      </div>

      {listView ? (
        <GraphListView agents={visibleAgents} tasks={taskList} />
      ) : (
        <svg
          ref={svgRef}
          viewBox="-420 -300 840 600"
          className="min-h-0 flex-1 cursor-grab touch-none rounded-md border border-ink-700 bg-ink-950 active:cursor-grabbing"
          role="application"
          aria-label="Swarm graph — agents and tasks"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <style>{`
            .sw-msg-edge { stroke-dasharray: 6 4; animation: sw-dash 0.8s linear infinite; }
            @keyframes sw-dash { to { stroke-dashoffset: -20; } }
            @media (prefers-reduced-motion: reduce) { .sw-msg-edge { animation: none; } }
          `}</style>
          <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
            {/* Structural edges */}
            {links.map((l, i) => {
              const s = typeof l.source === "object" ? l.source : null;
              const t = typeof l.target === "object" ? l.target : null;
              if (!s || !t) return null;
              const a = posOf(s.id);
              const b = posOf(t.id);
              const isCoord = s.id === "__coordinator__" || t.id === "__coordinator__";
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={l.kind === "dep" ? HEX.stoneDim : HEX.copper}
                  strokeWidth={l.kind === "dep" ? 0.75 : 1}
                  strokeOpacity={isCoord ? 0.25 : l.kind === "dep" ? 0.4 : 0.6}
                  aria-hidden
                />
              );
            })}
            {/* Animated message edges */}
            {messageEdges.map((m) => {
              const a = posOf(m.from);
              const b = posOf(m.to);
              return (
                <line
                  key={m.key}
                  className="sw-msg-edge"
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={HEX.copperLight}
                  strokeWidth={1.5}
                  aria-hidden
                />
              );
            })}

            {/* Nodes */}
            {nodes.map((n) => {
              const p = posOf(n.id);
              if (n.kind === "coordinator") {
                return (
                  <g
                    key={n.id}
                    data-node
                    transform={`translate(${p.x} ${p.y})`}
                    tabIndex={0}
                    role="img"
                    aria-label="Coordinator — orchestrates the swarm"
                    className="outline-none focus-visible:[&>polygon]:stroke-copper-300"
                  >
                    <polygon
                      points={hexPoints(n.r)}
                      fill={HEX.ink}
                      stroke={HEX.copper}
                      strokeWidth={1.5}
                    />
                    <text textAnchor="middle" dy={3} fontSize={8} fill={HEX.copperLight}>
                      ⌘
                    </text>
                    <text textAnchor="middle" y={n.r + 12} fontSize={9} fill={HEX.stone}>
                      coordinator
                    </text>
                  </g>
                );
              }
              if (n.kind === "agent") {
                const meta: StatusMeta = AGENT_STATUS_META[n.status as AgentStatus] ?? AGENT_STATUS_META.idle;
                const agentId = n.id.slice("agent:".length);
                const selected = selectedAgentId === agentId;
                const Icon = meta.icon;
                return (
                  <g
                    key={n.id}
                    data-node
                    transform={`translate(${p.x} ${p.y})`}
                    tabIndex={0}
                    role="button"
                    aria-label={`Agent ${n.label}, role ${n.sub}, status ${meta.label}. Press Enter to select.`}
                    aria-pressed={selected}
                    onClick={() => selectAgent(selected ? null : agentId)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectAgent(selected ? null : agentId);
                      }
                    }}
                    className="cursor-pointer outline-none"
                  >
                    <circle
                      r={n.r + (selected ? 3 : 0)}
                      fill={HEX.ink}
                      stroke={selected ? HEX.copperLight : meta.hex}
                      strokeWidth={selected ? 2.5 : 1.75}
                    />
                    <Icon x={-6} y={-6} width={12} height={12} color={meta.hex} aria-hidden />
                    <text textAnchor="middle" y={n.r + 12} fontSize={9} fill={HEX.stone}>
                      {truncate(n.sub, 18)}
                    </text>
                    <text textAnchor="middle" y={n.r + 22} fontSize={8} fill={HEX.stoneDim}>
                      {truncate(n.label, 18)}
                    </text>
                  </g>
                );
              }
              // task node
              const meta = TASK_STATUS_META[n.status as TaskStatus] ?? TASK_STATUS_META.pending;
              return (
                <g
                  key={n.id}
                  data-node
                  transform={`translate(${p.x} ${p.y})`}
                  tabIndex={0}
                  role="img"
                  aria-label={`Task ${n.label}, status ${meta.label}`}
                  className="outline-none"
                >
                  <rect
                    x={-n.r}
                    y={-n.r}
                    width={n.r * 2}
                    height={n.r * 2}
                    rx={3}
                    fill={meta.hex}
                    fillOpacity={n.status === "completed" ? 0.9 : 0.25}
                    stroke={meta.hex}
                    strokeWidth={1}
                  />
                  <text textAnchor="middle" y={n.r + 11} fontSize={8} fill={HEX.stone}>
                    {truncate(n.label, 16)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      )}

      {/* Mini action bar for the selected agent */}
      {selectedAgent && (
        <div
          role="toolbar"
          aria-label={`Actions for agent ${selectedAgent.name}`}
          className="flex flex-wrap items-center gap-2 rounded-md border border-copper-700 bg-ink-900 p-2"
        >
          <Badge tone={AGENT_STATUS_META[selectedAgent.status].tone}>
            {AGENT_STATUS_META[selectedAgent.status].label}
          </Badge>
          <span className="text-sm text-stone-200">
            {selectedAgent.name}
            <span className="ml-2 text-xs text-stone-500">{selectedAgent.role}</span>
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Tooltip content="Pauses the run between agent steps (agent-level control is routed via the run control endpoint)">
              <Button
                size="sm"
                variant="secondary"
                disabled={controlBusy || selectedAgent.status !== "active"}
                onClick={() => void control("pause", selectedAgent.id)}
              >
                Pause
              </Button>
            </Tooltip>
            <Tooltip content="Resumes the run (agent-level control is routed via the run control endpoint)">
              <Button
                size="sm"
                variant="secondary"
                disabled={controlBusy || selectedAgent.status !== "paused"}
                onClick={() => void control("resume", selectedAgent.id)}
              >
                Resume
              </Button>
            </Tooltip>
            <Tooltip content="Stops the run (agent-level control is routed via the run control endpoint)">
              <Button
                size="sm"
                variant="danger"
                disabled={controlBusy}
                onClick={() => void control("stop", selectedAgent.id)}
              >
                Stop
              </Button>
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────

function hexPoints(r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    pts.push(`${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Text alternative to the force graph (SPEC §6.2 accessibility). */
function GraphListView({
  agents,
  tasks,
}: {
  agents: FoldedAgent[];
  tasks: FoldedTask[];
}) {
  return (
    <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto md:grid-cols-2">
      <section className="rounded-md border border-ink-700 bg-ink-900 p-3" aria-label="Agents list">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
          Agents ({agents.length})
        </h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-700 text-left text-xs text-stone-500">
              <th className="py-1 pr-2 font-medium">Name</th>
              <th className="py-1 pr-2 font-medium">Role</th>
              <th className="py-1 pr-2 font-medium">Provider</th>
              <th className="py-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id} className="border-b border-ink-700/50 last:border-b-0">
                <td className="py-1 pr-2 text-stone-200">{a.name}</td>
                <td className="py-1 pr-2 text-stone-400">{a.role}</td>
                <td className="py-1 pr-2 text-stone-400">{a.provider || "—"}</td>
                <td className="py-1">
                  <Badge tone={AGENT_STATUS_META[a.status].tone}>
                    {AGENT_STATUS_META[a.status].label}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="rounded-md border border-ink-700 bg-ink-900 p-3" aria-label="Tasks list">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
          Tasks ({tasks.length})
        </h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-700 text-left text-xs text-stone-500">
              <th className="py-1 pr-2 font-medium">Title</th>
              <th className="py-1 pr-2 font-medium">Depends on</th>
              <th className="py-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} className="border-b border-ink-700/50 last:border-b-0">
                <td className="py-1 pr-2 text-stone-200">{t.title}</td>
                <td className="py-1 pr-2 font-mono text-xs text-stone-500">
                  {t.dependsOn.join(", ") || "—"}
                </td>
                <td className="py-1">
                  <Badge tone={TASK_STATUS_META[t.status].tone}>
                    {TASK_STATUS_META[t.status].label}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
