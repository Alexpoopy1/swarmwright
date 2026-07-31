import { db } from "@/server/db";
import { fromJson } from "@/server/json";
import { TaskGraph } from "./taskGraph";
import type { PlanContent, TaskProfile } from "@/types";

/**
 * Recruitment policy (SPEC §4.6).
 *
 * Triggers (checked in priority order):
 *  1. More than 2 ready tasks have no agent assigned → recruit for the role
 *     of the oldest ready task.
 *  2. Two or more agents have failed → recruit a replacement for the most
 *     recently failed role.
 *  3. A task has been blocked for over 60s → recruit help for its role.
 *
 * Hard caps: never suggest recruiting once the run already has `maxAgents`
 * agents; at the cap we instead suggest retiring a failed agent or merging
 * duplicate idle roles.
 */

export type RecruitmentDecision =
  | { action: "none" }
  | { action: "recruit"; role: string; reason: string; taskType: TaskProfile["taskType"] }
  | { action: "merge" | "retire"; agentId: string; reason: string };

const BLOCKED_THRESHOLD_MS = 60_000;

interface PlanIndex {
  roleById: Map<string, string>;
  taskTypeById: Map<string, TaskProfile["taskType"]>;
}

async function planIndexForRun(runId: string): Promise<PlanIndex> {
  const plan = await db.plan.findFirst({ where: { runId }, orderBy: { createdAt: "desc" } });
  const roleById = new Map<string, string>();
  const taskTypeById = new Map<string, TaskProfile["taskType"]>();
  if (plan) {
    const content = fromJson<PlanContent | null>(plan.contentJson, null);
    for (const t of content?.tasks ?? []) {
      roleById.set(t.id, t.role);
      taskTypeById.set(t.id, t.taskType);
    }
  }
  return { roleById, taskTypeById };
}

export async function evaluateRecruitment(runId: string): Promise<RecruitmentDecision> {
  const run = await db.agentRun.findUnique({
    where: { id: runId },
    include: { tasks: true, agents: true },
  });
  if (!run) return { action: "none" };

  const { roleById, taskTypeById } = await planIndexForRun(runId);
  const roleOf = (taskId: string, fallback: string) => roleById.get(taskId) ?? fallback;
  const taskTypeOf = (taskId: string): TaskProfile["taskType"] =>
    taskTypeById.get(taskId) ?? "general";

  const alive = run.agents.filter((a) => a.status !== "removed");
  const failedAgents = run.agents
    .filter((a) => a.status === "failed")
    .sort((a, b) => (b.endedAt ?? b.createdAt).getTime() - (a.endedAt ?? a.createdAt).getTime());
  const idleAgents = alive.filter((a) => a.status === "idle");

  // ── Hard cap reached: consolidate instead of recruiting. ──
  if (alive.length >= run.maxAgents) {
    if (failedAgents.length > 0) {
      return {
        action: "retire",
        agentId: failedAgents[0].id,
        reason: `Agent cap (${run.maxAgents}) reached; retiring failed agent "${failedAgents[0].name}" to free capacity.`,
      };
    }
    const byRole = new Map<string, typeof idleAgents>();
    for (const a of idleAgents) {
      const list = byRole.get(a.role) ?? [];
      list.push(a);
      byRole.set(a.role, list);
    }
    for (const [role, agents] of byRole) {
      if (agents.length >= 2) {
        return {
          action: "merge",
          agentId: agents[1].id,
          reason: `Two idle agents share role "${role}"; merging "${agents[1].name}" to stay within the cap.`,
        };
      }
    }
    return { action: "none" };
  }

  // ── Trigger 1: >2 ready tasks unassigned. ──
  const completed = new Set(run.tasks.filter((t) => t.status === "completed").map((t) => t.id));
  const active = new Set(run.tasks.filter((t) => t.status === "active").map((t) => t.id));
  const failedTasks = new Set(run.tasks.filter((t) => t.status === "failed").map((t) => t.id));
  const graph = new TaskGraph(
    run.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      dependsOn: fromJson<string[]>(t.dependsJson, []),
      role: roleOf(t.id, "generalist"),
      skills: [],
      parallelizable: true,
      taskType: taskTypeOf(t.id),
    })),
  );
  const readyUnassigned = graph
    .readyTasks(completed, active, failedTasks)
    .filter((t) => {
      const row = run.tasks.find((r) => r.id === t.id);
      return row && !row.agentId;
    });
  if (readyUnassigned.length > 2) {
    const target = readyUnassigned[0];
    return {
      action: "recruit",
      role: target.role,
      reason: `${readyUnassigned.length} tasks are ready with no agent assigned; recruiting a "${target.role}" for "${target.title}".`,
      taskType: target.taskType,
    };
  }

  // ── Trigger 2: two or more agents failed → replacement. ──
  if (failedAgents.length >= 2) {
    const worst = failedAgents[0];
    const task = run.tasks.find((t) => t.agentId === worst.id);
    return {
      action: "recruit",
      role: worst.role,
      reason: `${failedAgents.length} agents have failed; recruiting a replacement "${worst.role}".`,
      taskType: task ? taskTypeOf(task.id) : "general",
    };
  }

  // ── Trigger 3: a task blocked for >60s. ──
  const cutoff = Date.now() - BLOCKED_THRESHOLD_MS;
  const blockedLong = run.tasks
    .filter((t) => t.status === "blocked" && t.createdAt.getTime() < cutoff)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  if (blockedLong) {
    return {
      action: "recruit",
      role: roleOf(blockedLong.id, "generalist"),
      reason: `Task "${blockedLong.title}" has been blocked for over 60s; recruiting help.`,
      taskType: taskTypeOf(blockedLong.id),
    };
  }

  return { action: "none" };
}
