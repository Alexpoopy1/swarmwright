import { db } from "@/server/db";
import { fromJson, toJson } from "@/server/json";
import { publish } from "@/server/events/bus";
import type {
  EventActorType,
  EventType,
  PlanContent,
  RunSnapshot,
  SwarmEvent,
} from "@/types";

/**
 * Event store — the append-only, event-sourced history of the system.
 * Powers live SSE updates AND the Swarm Time Machine (state is a fold
 * over events, so any point in time can be reconstructed).
 */

type Row = {
  id: number;
  runId: string | null;
  projectId: string | null;
  type: string;
  actorType: string;
  actorId: string | null;
  summary: string;
  payloadJson: string;
  createdAt: Date;
};

function toSwarmEvent(row: Row): SwarmEvent {
  return {
    seq: row.id,
    runId: row.runId,
    projectId: row.projectId,
    type: row.type as EventType,
    actorType: row.actorType as EventActorType,
    actorId: row.actorId,
    summary: row.summary,
    payload: fromJson(row.payloadJson, {}),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function emitEvent(e: {
  runId?: string | null;
  projectId?: string | null;
  type: EventType;
  actorType?: EventActorType;
  actorId?: string | null;
  summary?: string;
  payload?: unknown;
}): Promise<SwarmEvent> {
  const row = await db.event.create({
    data: {
      runId: e.runId ?? null,
      projectId: e.projectId ?? null,
      type: e.type,
      actorType: e.actorType ?? "system",
      actorId: e.actorId ?? null,
      summary: e.summary ?? "",
      payloadJson: toJson(e.payload ?? {}),
    },
  });
  const event = toSwarmEvent(row);
  publish(event);
  return event;
}

export async function listEvents(opts: {
  runId?: string;
  projectId?: string;
  afterSeq?: number;
  limit?: number;
}): Promise<SwarmEvent[]> {
  const rows = await db.event.findMany({
    where: {
      runId: opts.runId,
      projectId: opts.projectId,
      id: opts.afterSeq ? { gt: opts.afterSeq } : undefined,
    },
    orderBy: { id: "asc" },
    take: opts.limit ?? 500,
  });
  return rows.map(toSwarmEvent);
}

/** Latest persisted sequence number for a run (0 when none). */
export async function latestSeq(runId: string): Promise<number> {
  const row = await db.event.findFirst({
    where: { runId },
    orderBy: { id: "desc" },
    select: { id: true },
  });
  return row?.id ?? 0;
}

/**
 * Fold an event stream into the run state at that point in time.
 * This is the heart of the Swarm Time Machine: scrubbing = folding
 * a prefix of the event log.
 */
export function reconstructRunState(events: SwarmEvent[]): RunSnapshot {
  const snap: RunSnapshot = {
    runId: "",
    status: "queued",
    goal: "",
    plan: null,
    taskStates: [],
    agentStates: [],
    costUsd: 0,
    tokensUsed: 0,
    eventSeq: 0,
    createdAt: events[0]?.createdAt ?? new Date().toISOString(),
  };
  const tasks = new Map<string, RunSnapshot["taskStates"][number]>();
  const agents = new Map<string, RunSnapshot["agentStates"][number]>();

  for (const e of events) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    snap.eventSeq = e.seq;
    if (e.runId) snap.runId = e.runId;

    switch (e.type) {
      case "RUN_CREATED":
        snap.status = "queued";
        snap.goal = (p.goal as string) ?? snap.goal;
        break;
      case "RUN_PAUSED":
        snap.status = "paused";
        break;
      case "RUN_RESUMED":
        snap.status = "running";
        break;
      case "RUN_COMPLETED":
        snap.status = "completed";
        break;
      case "RUN_FAILED":
        snap.status = "failed";
        break;
      case "RUN_STOPPED":
        snap.status = "stopped";
        break;
      case "PLAN_CREATED":
      case "PLAN_EDITED":
        snap.plan = (p.plan as PlanContent) ?? snap.plan;
        if (snap.status === "queued" || snap.status === "planning") snap.status = "planning";
        break;
      case "PLAN_APPROVED":
        snap.status = "running";
        break;
      case "TASK_CREATED": {
        const id = (p.taskId as string) ?? "";
        if (id && !tasks.has(id)) {
          tasks.set(id, {
            id,
            title: (p.title as string) ?? id,
            status: "pending",
            agentId: null,
            attempts: 0,
            result: null,
          });
        }
        break;
      }
      case "TASK_STARTED": {
        const t = tasks.get(p.taskId as string);
        if (t) {
          t.status = "active";
          t.agentId = (p.agentId as string) ?? t.agentId;
          t.attempts = (p.attempts as number) ?? t.attempts;
        }
        break;
      }
      case "TASK_BLOCKED": {
        const t = tasks.get(p.taskId as string);
        if (t) t.status = "blocked";
        break;
      }
      case "TASK_COMPLETED": {
        const t = tasks.get(p.taskId as string);
        if (t) {
          t.status = "completed";
          t.result = (p.result as string) ?? t.result;
        }
        break;
      }
      case "TASK_FAILED": {
        const t = tasks.get(p.taskId as string);
        if (t) t.status = "failed";
        break;
      }
      case "TASK_RETRIED": {
        const t = tasks.get(p.taskId as string);
        if (t) {
          t.status = "pending";
          t.attempts = (p.attempts as number) ?? t.attempts + 1;
        }
        break;
      }
      case "AGENT_CREATED":
      case "AGENT_RECRUITED": {
        const id = (p.agentId as string) ?? e.actorId ?? "";
        if (id) {
          agents.set(id, {
            id,
            name: (p.name as string) ?? id,
            role: (p.role as string) ?? "agent",
            status: "idle",
            provider: (p.provider as string) ?? "",
            model: (p.model as string) ?? "",
            genomeId: (p.genomeId as string) ?? null,
          });
        }
        break;
      }
      case "AGENT_STARTED": {
        const a = agents.get((p.agentId as string) ?? e.actorId ?? "");
        if (a) a.status = "active";
        if (snap.status !== "awaiting_approval") snap.status = "running";
        break;
      }
      case "AGENT_PAUSED": {
        const a = agents.get((p.agentId as string) ?? e.actorId ?? "");
        if (a) a.status = "paused";
        break;
      }
      case "AGENT_RESUMED": {
        const a = agents.get((p.agentId as string) ?? e.actorId ?? "");
        if (a) a.status = "active";
        break;
      }
      case "AGENT_COMPLETED": {
        const a = agents.get((p.agentId as string) ?? e.actorId ?? "");
        if (a) a.status = "completed";
        break;
      }
      case "AGENT_FAILED": {
        const a = agents.get((p.agentId as string) ?? e.actorId ?? "");
        if (a) a.status = "failed";
        break;
      }
      case "AGENT_REMOVED": {
        const a = agents.get((p.agentId as string) ?? e.actorId ?? "");
        if (a) a.status = "removed";
        break;
      }
      case "APPROVAL_REQUESTED":
      case "TOOL_APPROVAL_REQUIRED":
        snap.status = "awaiting_approval";
        break;
      case "APPROVAL_RESOLVED":
      case "TOOL_APPROVED":
      case "TOOL_REJECTED":
        if (snap.status === "awaiting_approval") snap.status = "running";
        break;
      default:
        break;
    }

    // Cost/token accumulation — any event may carry usage in its payload.
    if (typeof p.costUsd === "number") snap.costUsd += p.costUsd;
    if (typeof p.tokens === "number") snap.tokensUsed += p.tokens;
  }

  snap.taskStates = [...tasks.values()];
  snap.agentStates = [...agents.values()];
  return snap;
}
