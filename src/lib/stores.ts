/**
 * Client state stores (SPEC §6.3).
 *
 * `useRunStore` — event-sourced fold of a run's SwarmEvent stream. Mirrors
 * the semantics of `reconstructRunState` (src/server/events/store.ts) but
 * keeps live Maps for O(1) lookups by the workspace components.
 * `useUiStore` — workspace UI prefs (particle effects toggle persisted to
 * localStorage `sw.effects`, selected agent, active inspector tab).
 */
"use client";

import { create } from "zustand";
import type {
  AgentStatus,
  PlanContent,
  RunStatus,
  SwarmEvent,
  TaskStatus,
} from "@/types";

// ─────────────────────────────────────────────────────────────
// Fold types
// ─────────────────────────────────────────────────────────────

export interface FoldedAgent {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  provider: string;
  model: string;
  genomeId: string | null;
  /** Latest user-safe activity bubble (from status actions / agent rows). */
  summary: string;
  confidence: number;
  costUsd: number;
  tokens: number;
}

export interface FoldedTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  agentId: string | null;
  attempts: number;
  dependsOn: string[];
  result: string | null;
  error: string | null;
}

export interface RunFold {
  status: RunStatus;
  goal: string;
  plan: PlanContent | null;
  agents: Map<string, FoldedAgent>;
  tasks: Map<string, FoldedTask>;
  costUsd: number;
  tokensUsed: number;
  lastSeq: number;
}

function emptyFold(): RunFold {
  return {
    status: "queued",
    goal: "",
    plan: null,
    agents: new Map(),
    tasks: new Map(),
    costUsd: 0,
    tokensUsed: 0,
    lastSeq: 0,
  };
}

/**
 * Apply one event to the fold. Mirrors reconstructRunState (RUN_* status
 * transitions, PLAN_* content, TASK_* lifecycle, AGENT_* lifecycle, plus
 * cost/token accumulation from payload.costUsd / payload.tokens). Mutates
 * the draft Maps; caller passes fresh copies.
 */
export function foldEventInto(fold: RunFold, e: SwarmEvent): void {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  fold.lastSeq = Math.max(fold.lastSeq, e.seq);

  const agentKey = () => (p.agentId as string) ?? e.actorId ?? "";

  switch (e.type) {
    case "RUN_CREATED":
      fold.status = "queued";
      fold.goal = (p.goal as string) ?? fold.goal;
      break;
    case "RUN_PAUSED":
      fold.status = "paused";
      break;
    case "RUN_RESUMED":
      fold.status = "running";
      break;
    case "RUN_COMPLETED":
      fold.status = "completed";
      break;
    case "RUN_FAILED":
      fold.status = "failed";
      break;
    case "RUN_STOPPED":
      fold.status = "stopped";
      break;
    case "PLAN_CREATED":
    case "PLAN_EDITED":
      fold.plan = (p.plan as PlanContent) ?? fold.plan;
      if (fold.status === "queued") fold.status = "planning";
      break;
    case "PLAN_APPROVED":
      fold.status = "running";
      break;
    case "PLAN_REJECTED":
      if (fold.status === "awaiting_approval") fold.status = "paused";
      break;
    case "TASK_CREATED": {
      const id = (p.taskId as string) ?? "";
      if (id && !fold.tasks.has(id)) {
        fold.tasks.set(id, {
          id,
          title: (p.title as string) ?? id,
          description: (p.description as string) ?? "",
          status: "pending",
          agentId: null,
          attempts: 0,
          dependsOn: Array.isArray(p.dependsOn) ? (p.dependsOn as string[]) : [],
          result: null,
          error: null,
        });
      }
      break;
    }
    case "TASK_STARTED": {
      const t = fold.tasks.get(p.taskId as string);
      if (t) {
        t.status = "active";
        t.agentId = (p.agentId as string) ?? t.agentId;
        t.attempts = (p.attempts as number) ?? t.attempts;
      }
      break;
    }
    case "TASK_BLOCKED": {
      const t = fold.tasks.get(p.taskId as string);
      if (t) t.status = "blocked";
      break;
    }
    case "TASK_COMPLETED": {
      const t = fold.tasks.get(p.taskId as string);
      if (t) {
        t.status = "completed";
        t.result = (p.result as string) ?? t.result;
      }
      break;
    }
    case "TASK_FAILED": {
      const t = fold.tasks.get(p.taskId as string);
      if (t) {
        t.status = "failed";
        t.error = (p.error as string) ?? t.error;
      }
      break;
    }
    case "TASK_RETRIED": {
      const t = fold.tasks.get(p.taskId as string);
      if (t) {
        t.status = "pending";
        t.attempts = (p.attempts as number) ?? t.attempts + 1;
      }
      break;
    }
    case "AGENT_CREATED":
    case "AGENT_RECRUITED": {
      const id = agentKey();
      if (id) {
        fold.agents.set(id, {
          id,
          name: (p.name as string) ?? id,
          role: (p.role as string) ?? "agent",
          status: "idle",
          provider: (p.provider as string) ?? "",
          model: (p.model as string) ?? "",
          genomeId: (p.genomeId as string) ?? null,
          summary: "",
          confidence: 0.5,
          costUsd: 0,
          tokens: 0,
        });
      }
      break;
    }
    case "AGENT_STARTED": {
      const a = fold.agents.get(agentKey());
      if (a) a.status = "active";
      if (fold.status !== "awaiting_approval") fold.status = "running";
      break;
    }
    case "AGENT_PAUSED": {
      const a = fold.agents.get(agentKey());
      if (a) a.status = "paused";
      break;
    }
    case "AGENT_RESUMED": {
      const a = fold.agents.get(agentKey());
      if (a) a.status = "active";
      break;
    }
    case "AGENT_COMPLETED": {
      const a = fold.agents.get(agentKey());
      if (a) a.status = "completed";
      break;
    }
    case "AGENT_FAILED": {
      const a = fold.agents.get(agentKey());
      if (a) {
        a.status = "failed";
        if (typeof p.error === "string") a.summary = p.error;
      }
      break;
    }
    case "AGENT_REMOVED": {
      const a = fold.agents.get(agentKey());
      if (a) a.status = "removed";
      break;
    }
    case "AGENT_MESSAGE": {
      // Agent messages carry the sender's user-safe summary + confidence —
      // feed the thinking bubble and per-agent confidence.
      const a = fold.agents.get((p.fromAgentId as string) ?? agentKey());
      if (a) {
        if (typeof p.summary === "string") a.summary = p.summary;
        if (typeof p.confidence === "number") a.confidence = p.confidence;
      }
      break;
    }
    case "APPROVAL_REQUESTED":
    case "TOOL_APPROVAL_REQUIRED":
      fold.status = "awaiting_approval";
      break;
    case "APPROVAL_RESOLVED":
    case "TOOL_APPROVED":
    case "TOOL_REJECTED":
      if (fold.status === "awaiting_approval") fold.status = "running";
      break;
    default:
      break;
  }

  // Cost/token accumulation — any event may carry usage in its payload.
  if (typeof p.costUsd === "number") {
    fold.costUsd += p.costUsd;
    const a = fold.agents.get(agentKey());
    if (a) a.costUsd += p.costUsd;
  }
  if (typeof p.tokens === "number") {
    fold.tokensUsed += p.tokens;
    const a = fold.agents.get(agentKey());
    if (a) a.tokens += p.tokens;
  }
  // Status bubble updates can arrive on any agent-actor event summary.
  if (e.actorType === "agent" && e.actorId) {
    const a = fold.agents.get(e.actorId);
    if (a && e.summary && e.type !== "AGENT_MESSAGE") a.summary = e.summary;
  }
}

// ─────────────────────────────────────────────────────────────
// useRunStore
// ─────────────────────────────────────────────────────────────

interface RunStoreState extends RunFold {
  runId: string | null;
  events: SwarmEvent[];
  /** Non-null once the SSE stream gave up reconnecting. */
  streamError: string | null;
  reset: (runId?: string | null) => void;
  applyEvent: (event: SwarmEvent) => void;
  /** Bulk-load (replay / initial snapshot) — replaces all state. */
  setInitial: (runId: string, events: SwarmEvent[]) => void;
  setStreamError: (message: string | null) => void;
}

export const useRunStore = create<RunStoreState>((set) => ({
  ...emptyFold(),
  runId: null,
  events: [],
  streamError: null,

  reset: (runId = null) =>
    set({ ...emptyFold(), runId, events: [], streamError: null }),

  applyEvent: (event) =>
    set((state) => {
      // Ignore duplicates on reconnect replay (seq cursor guarantees order,
      // but be defensive — replays from events-list + SSE can overlap).
      if (event.seq <= state.lastSeq) return state;
      const fold: RunFold = {
        status: state.status,
        goal: state.goal,
        plan: state.plan,
        agents: new Map(state.agents),
        tasks: new Map(state.tasks),
        costUsd: state.costUsd,
        tokensUsed: state.tokensUsed,
        lastSeq: state.lastSeq,
      };
      foldEventInto(fold, event);
      return { ...fold, events: [...state.events, event] };
    }),

  setInitial: (runId, events) =>
    set(() => {
      const fold = emptyFold();
      for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
        foldEventInto(fold, e);
      }
      return { ...fold, runId, events, streamError: null };
    }),

  setStreamError: (message) => set({ streamError: message }),
}));

// ─────────────────────────────────────────────────────────────
// useUiStore
// ─────────────────────────────────────────────────────────────

const EFFECTS_KEY = "sw.effects";

function readEffectsPref(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(EFFECTS_KEY) !== "off";
  } catch {
    return true;
  }
}

interface UiStoreState {
  /** Particle effects on/off (persisted to localStorage `sw.effects`). */
  effectsEnabled: boolean;
  /** Agent selected in the swarm graph / inspector. */
  selectedAgentId: string | null;
  /** Active main tab on the run workspace (plan | board | swarm | timeline). */
  activeTab: string;
  setEffectsEnabled: (on: boolean) => void;
  selectAgent: (id: string | null) => void;
  setActiveTab: (tab: string) => void;
}

export const useUiStore = create<UiStoreState>((set) => ({
  effectsEnabled: readEffectsPref(),
  selectedAgentId: null,
  activeTab: "plan",

  setEffectsEnabled: (on) => {
    try {
      window.localStorage.setItem(EFFECTS_KEY, on ? "on" : "off");
    } catch {
      /* private mode */
    }
    set({ effectsEnabled: on });
  },
  selectAgent: (id) => set({ selectedAgentId: id }),
  setActiveTab: (tab) => set({ activeTab: tab }),
}));

/** True when particle animation should run (effects on + no reduced-motion). */
export function shouldAnimate(effectsEnabled: boolean): boolean {
  if (!effectsEnabled) return false;
  if (typeof window === "undefined") return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
