import { db } from "@/server/db";
import { fromJson, toJson } from "@/server/json";
import { emitEvent, listEvents, reconstructRunState } from "@/server/events/store";
import type {
  Agent,
  AgentRun,
  Task,
} from "@prisma/client";
import {
  planContentSchema,
  type AgentAction,
  type AutonomyMode,
  type ChatMessage,
  type PlanContent,
  type PlanMode,
  type PlanTask,
  type RunLimits,
  type RunSnapshot,
  type RunStatus,
  type StartRunInput,
  type TaskProfile,
} from "@/types";
import { routeModel } from "@/server/router/modelRouter";
import { checkRunBudget } from "@/server/usage/meter";
import { proposeTool, executeTool } from "@/server/tools/factory";
import { upsertFile } from "@/server/projects";
import { TaskGraph } from "./taskGraph";
import { generatePlan } from "./planner";
import { buildAgentContext, runAgentStep } from "./agentRuntime";
import { evaluateRecruitment } from "./recruitment";
import { matchGenome, seedDefaultGenomes, recordRunOutcome } from "./genome";
import { createCheckpoint, latestCheckpoint, restoreSnapshot } from "./checkpoints";
import { sendAgentMessage } from "./messages";
import { saveMemory } from "@/server/memory";
import { OrchestratorError } from "./errors";

/**
 * The durable orchestration engine (SPEC §4.6).
 *
 * - In-process async loops, one per run, tracked in a globalThis singleton so
 *   Next dev hot-reloads never spawn duplicates.
 * - All durable state lives in SQLite (runs, tasks, agents, events,
 *   checkpoints); a loop can always be re-kicked from DB state, which is what
 *   pause/resume, retry, fork and crash recovery all build on.
 * - Every state change is an event with a Time Machine-friendly payload.
 */

// ─────────────────────────────────────────────────────────────
// Tunables
// ─────────────────────────────────────────────────────────────
const DEFAULT_LIMITS: RunLimits = {
  budgetUsd: 5,
  tokenLimit: 500_000,
  timeLimitSec: 1800,
  maxAgents: 8,
  maxConcurrentAgents: 4,
  maxRetries: 3,
};
const POLL_MS = 1000;
const IDLE_POLL_MS = 300;
const CHECKPOINT_EVENT_INTERVAL = 15;
const LOOP_DETECTION_LIMIT = 12;
const MAX_STEPS_PER_TASK = 25;
const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
const BUDGET_WARNING_THRESHOLD = 0.8;
const AGENT_NAMES = [
  "Atlas", "Nova", "Orion", "Lyra", "Vega", "Mira", "Ceres", "Io",
  "Rhea", "Juno", "Sol", "Nyx", "Echo", "Aster", "Pax", "Rune",
];

// ─────────────────────────────────────────────────────────────
// Per-run in-process state (never the source of truth — the DB is)
// ─────────────────────────────────────────────────────────────
interface RunControl {
  abort: AbortController;
  input?: StartRunInput & { workspaceId: string };
  emittedSinceCheckpoint: number;
  budgetWarningSent: boolean;
  budgetExceededActive: boolean;
  iterationsSinceProgress: number;
}

const globalEngine = globalThis as unknown as {
  __swRunControllers?: Map<string, RunControl>;
};

function controllers(): Map<string, RunControl> {
  if (!globalEngine.__swRunControllers) globalEngine.__swRunControllers = new Map();
  return globalEngine.__swRunControllers;
}

// ─────────────────────────────────────────────────────────────
// Small utilities
// ─────────────────────────────────────────────────────────────
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function errorMessage(err: unknown): string {
  if (err instanceof OrchestratorError) return `${err.code}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

async function getRun(runId: string): Promise<AgentRun> {
  const run = await db.agentRun.findUnique({ where: { id: runId } });
  if (!run) throw new OrchestratorError("run_not_found", `Run ${runId} not found`);
  return run;
}

/** Emit an engine event and count it toward the checkpoint interval. */
async function emit(
  ctrl: RunControl,
  run: { id: string; projectId: string },
  type: Parameters<typeof emitEvent>[0]["type"],
  opts: {
    actorType?: "system" | "agent" | "user" | "coordinator";
    actorId?: string | null;
    summary?: string;
    payload?: unknown;
  } = {},
) {
  ctrl.emittedSinceCheckpoint += 1;
  return emitEvent({ runId: run.id, projectId: run.projectId, type, ...opts });
}

async function maybeAutoCheckpoint(ctrl: RunControl, runId: string): Promise<void> {
  if (ctrl.emittedSinceCheckpoint < CHECKPOINT_EVENT_INTERVAL) return;
  ctrl.emittedSinceCheckpoint = 0;
  try {
    const cp = await createCheckpoint(runId, "auto");
    // Counted separately so a checkpoint never recursively triggers another.
    await emitEvent({
      runId,
      type: "CHECKPOINT_CREATED",
      summary: `Checkpoint (${cp.label}) at event ${cp.eventSeq}`,
      payload: { checkpointId: cp.id, label: cp.label, eventSeq: cp.eventSeq },
    });
  } catch (err) {
    // Checkpoints are durability insurance; never kill a run over one.
    console.error(`[engine] checkpoint failed for run ${runId}:`, errorMessage(err));
  }
}

async function setRunStatus(runId: string, status: RunStatus, extra: Record<string, unknown> = {}) {
  await db.agentRun.update({ where: { id: runId }, data: { status, ...extra } });
}

/** Wait while the run is paused; returns false when aborted/stopped meanwhile. */
async function waitWhilePaused(runId: string, signal: AbortSignal): Promise<boolean> {
  for (;;) {
    if (signal.aborted) return false;
    const status = (await getRun(runId)).status as RunStatus;
    if (status === "paused") {
      await sleep(POLL_MS, signal);
      continue;
    }
    if (status === "stopped" || status === "failed" || status === "completed") return false;
    return true;
  }
}

/** Wait until a pending approval row is decided. Timeout → expire + reject. */
async function waitForApproval(
  run: { id: string; projectId: string },
  approvalId: string,
  signal: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + APPROVAL_TIMEOUT_MS;
  for (;;) {
    if (signal.aborted) return false;
    const approval = await db.approval.findUnique({ where: { id: approvalId } });
    if (!approval) return false;
    if (approval.status === "approved") return true;
    if (approval.status === "rejected" || approval.status === "expired") return false;
    if (Date.now() > deadline) {
      await db.approval.update({
        where: { id: approvalId },
        data: { status: "expired", decidedAt: new Date() },
      });
      await emitEvent({
        runId: run.id,
        projectId: run.projectId,
        type: "APPROVAL_RESOLVED",
        summary: `Approval "${approval.title}" timed out after 10 minutes — rejected`,
        payload: { approvalId, decision: "rejected", reason: "timeout" },
      });
      return false;
    }
    await sleep(POLL_MS, signal);
  }
}

/** Find a pending approval created by the tool factory for this run/agent. */
async function pendingApprovalFor(runId: string, agentId: string | undefined, since: Date) {
  return db.approval.findFirst({
    where: {
      runId,
      status: "pending",
      createdAt: { gte: new Date(since.getTime() - 5000) },
      ...(agentId ? { agentId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

// ─────────────────────────────────────────────────────────────
// Agent/task provisioning
// ─────────────────────────────────────────────────────────────
function connectionIdFromDecision(decision: { connectionId: string }): string {
  return decision.connectionId;
}

async function provisionAgent(
  ctrl: RunControl,
  run: AgentRun & { project: { workspaceId: string } },
  task: Task,
  planTask: PlanTask | undefined,
  opts: { recruited?: boolean; nameIndex: number; forceModel?: { provider: string; model: string } },
): Promise<{ agent: Agent; connectionId: string }> {
  const workspaceId = run.project.workspaceId;
  const role = planTask?.role ?? task.title;
  const taskType: TaskProfile["taskType"] = planTask?.taskType ?? "general";

  const genome = await matchGenome(workspaceId, role, taskType).catch(() => null);
  const decision = await routeModel(workspaceId, {
    taskType,
    qualityWeight: 0.7,
    forceProvider: opts.forceModel?.provider,
    forceModel: opts.forceModel?.model,
  });
  if (!decision) {
    throw new OrchestratorError(
      "no_provider",
      "No provider connection can serve this run. Connect a provider first.",
    );
  }

  const name = `${AGENT_NAMES[opts.nameIndex % AGENT_NAMES.length]} · ${role}`;
  const agent = await db.agent.create({
    data: {
      runId: run.id,
      name,
      role,
      provider: decision.provider,
      model: decision.model,
      status: "idle",
      genomeId: genome?.id ?? null,
      recruited: opts.recruited ?? false,
      summary: "Starting up",
    },
  });
  const type = opts.recruited ? "AGENT_RECRUITED" : "AGENT_CREATED";
  await emit(ctrl, run, type, {
    actorType: "coordinator",
    actorId: agent.id,
    summary: `${agent.name} joined the run (${decision.provider}/${decision.model})`,
    payload: {
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      provider: agent.provider,
      model: agent.model,
      genomeId: agent.genomeId,
      taskId: task.id,
      reason: decision.reason,
    },
  });
  return { agent, connectionId: connectionIdFromDecision(decision) };
}

// ─────────────────────────────────────────────────────────────
// Action effects
// ─────────────────────────────────────────────────────────────
interface StepOutcome {
  taskDone: boolean;
  taskFailed: boolean;
  failureError?: string;
  failureRetryable?: boolean;
  result?: string;
  confidence?: number;
  wroteFile: boolean;
}

async function applyAction(
  ctrl: RunControl,
  run: AgentRun & { project: { workspaceId: string } },
  agent: Agent,
  task: Task,
  action: AgentAction,
  spawnRecruitForRole: (role: string, taskType: TaskProfile["taskType"], reason: string) => Promise<void>,
): Promise<StepOutcome> {
  const base: StepOutcome = {
    taskDone: false,
    taskFailed: false,
    wroteFile: false,
  };

  switch (action.type) {
    case "status": {
      await db.agent.update({ where: { id: agent.id }, data: { summary: action.bubble } });
      break;
    }

    case "message": {
      await sendAgentMessage({
        runId: run.id,
        fromAgentId: agent.id,
        to: action.to,
        summary: action.summary,
        payload: action.payload,
        confidence: action.confidence,
        requestedAction: action.requestedAction,
      });
      ctrl.emittedSinceCheckpoint += 1; // AGENT_MESSAGE + MEMORY_SAVED were emitted
      break;
    }

    case "file_write": {
      const entry = await upsertFile(run.projectId, action.path, action.content);
      base.wroteFile = true;
      await emit(ctrl, run, entry.version > 1 ? "FILE_UPDATED" : "FILE_CREATED", {
        actorType: "agent",
        actorId: agent.id,
        summary: `${agent.name} ${entry.version > 1 ? "updated" : "created"} ${entry.path} (v${entry.version})`,
        payload: { path: entry.path, version: entry.version, agentId: agent.id, taskId: task.id },
      });
      break;
    }

    case "tool_call": {
      const tool = await db.toolDefinition.findFirst({
        where: { projectId: run.projectId, name: action.toolName },
        orderBy: { version: "desc" },
      });
      if (!tool) {
        await db.agent.update({
          where: { id: agent.id },
          data: { summary: `Tool "${action.toolName}" not found` },
        });
        await emit(ctrl, run, "TOOL_FAILED", {
          actorType: "agent",
          actorId: agent.id,
          summary: `Tool "${action.toolName}" is not registered in this project`,
          payload: { toolName: action.toolName, agentId: agent.id, taskId: task.id, error: "tool_not_found" },
        });
        break;
      }
      const since = new Date();
      const result = await executeTool({
        toolId: tool.id,
        input: action.input,
        runId: run.id,
        agentId: agent.id,
        taskId: task.id,
        autonomy: run.autonomy as AutonomyMode,
      });
      ctrl.emittedSinceCheckpoint += 2; // TOOL_STARTED / TOOL_COMPLETED (or TOOL_APPROVAL_REQUIRED) come from the factory

      if (result.ok) break;

      if (result.error === "approval_required") {
        // The factory gated the call and created an Approval row.
        if (run.autonomy === "ask_risky" || run.autonomy === "ask_all") {
          const pending = await pendingApprovalFor(run.id, agent.id, since);
          if (pending) {
            await setRunStatus(run.id, "awaiting_approval");
            await emit(ctrl, run, "APPROVAL_REQUESTED", {
              actorType: "system",
              summary: `Approval needed: ${pending.title}`,
              payload: { approvalId: pending.id, kind: pending.kind, riskLevel: pending.riskLevel },
            });
            const approved = await waitForApproval(run, pending.id, ctrl.abort.signal);
            await setRunStatus(run.id, "running");
            if (approved) {
              // Permission granted: run once more with the gate lifted.
              await executeTool({
                toolId: tool.id,
                input: action.input,
                runId: run.id,
                agentId: agent.id,
                taskId: task.id,
                autonomy: "auto",
              });
              ctrl.emittedSinceCheckpoint += 2;
            } else {
              await db.agent.update({
                where: { id: agent.id },
                data: { summary: `Tool call "${action.toolName}" was rejected` },
              });
            }
          }
        } else {
          // observe/auto: no approval flow — note the denial and move on.
          await db.agent.update({
            where: { id: agent.id },
            data: { summary: `Tool call "${action.toolName}" denied by policy (${run.autonomy})` },
          });
        }
        break;
      }

      // Genuine tool failure: surface it to the agent on its next step.
      await db.agent.update({
        where: { id: agent.id },
        data: { summary: `Tool "${action.toolName}" failed: ${(result.error ?? "unknown").slice(0, 100)}` },
      });
      break;
    }

    case "tool_propose": {
      const since = new Date();
      const result = await proposeTool({
        projectId: run.projectId,
        runId: run.id,
        agentId: agent.id,
        proposal: action,
        autonomy: run.autonomy as AutonomyMode,
      });
      ctrl.emittedSinceCheckpoint += 2; // TOOL_PROPOSED / tests / TOOL_REGISTERED from the factory
      if (result.status === "pending_approval") {
        const pending = await pendingApprovalFor(run.id, agent.id, since);
        if (pending) {
          await setRunStatus(run.id, "awaiting_approval");
          await emit(ctrl, run, "APPROVAL_REQUESTED", {
            actorType: "system",
            summary: `Approval needed: ${pending.title}`,
            payload: { approvalId: pending.id, kind: pending.kind, riskLevel: pending.riskLevel },
          });
          const approved = await waitForApproval(run, pending.id, ctrl.abort.signal);
          await setRunStatus(run.id, "running");
          if (!approved) {
            await db.agent.update({
              where: { id: agent.id },
              data: { summary: `Tool proposal "${action.name}" was rejected` },
            });
          }
        }
      }
      break;
    }

    case "recruit_request": {
      const decision = await evaluateRecruitment(run.id);
      const currentAgents = await db.agent.count({
        where: { runId: run.id, status: { notIn: ["removed"] } },
      });
      if (currentAgents >= run.maxAgents) {
        await db.agent.update({
          where: { id: agent.id },
          data: { summary: `Recruitment denied — agent cap (${run.maxAgents}) reached` },
        });
        break;
      }
      if (run.autonomy !== "auto") {
        const approval = await db.approval.create({
          data: {
            runId: run.id,
            agentId: agent.id,
            kind: "recruitment",
            title: `Recruit "${action.role}"`,
            detailJson: toJson({
              role: action.role,
              reason: action.reason,
              taskType: action.taskType,
              policy: decision.action === "recruit" ? decision.reason : "agent-requested",
            }),
            riskLevel: "low",
          },
        });
        await setRunStatus(run.id, "awaiting_approval");
        await emit(ctrl, run, "APPROVAL_REQUESTED", {
          actorType: "agent",
          actorId: agent.id,
          summary: `${agent.name} requests recruiting "${action.role}": ${action.reason}`,
          payload: { approvalId: approval.id, kind: "recruitment", role: action.role },
        });
        const approved = await waitForApproval(run, approval.id, ctrl.abort.signal);
        await setRunStatus(run.id, "running");
        if (approved) {
          await spawnRecruitForRole(action.role, action.taskType, action.reason);
        }
      } else {
        await spawnRecruitForRole(action.role, action.taskType, action.reason);
      }
      break;
    }

    case "task_complete": {
      base.taskDone = true;
      base.result = action.result;
      base.confidence = action.confidence;
      break;
    }

    case "task_failed": {
      base.taskFailed = true;
      base.failureError = action.error;
      base.failureRetryable = action.retryable;
      break;
    }
  }
  return base;
}

// ─────────────────────────────────────────────────────────────
// Per-task agent loop
// ─────────────────────────────────────────────────────────────
async function completeTaskSuccess(
  ctrl: RunControl,
  run: AgentRun & { project: { workspaceId: string } },
  agent: Agent,
  task: Task,
  planTask: PlanTask | undefined,
  outcome: StepOutcome,
  latencyMsTotal: number,
): Promise<void> {
  const done = await db.task.update({
    where: { id: task.id },
    data: { status: "completed", result: outcome.result ?? "", endedAt: new Date() },
  });
  const finishedAgent = await db.agent.update({
    where: { id: agent.id },
    data: {
      status: "completed",
      endedAt: new Date(),
      summary: outcome.result?.slice(0, 200) || agent.summary,
      confidence: outcome.confidence ?? agent.confidence,
    },
  });
  await emit(ctrl, run, "TASK_COMPLETED", {
    actorType: "agent",
    actorId: agent.id,
    summary: `${agent.name} completed "${task.title}"`,
    payload: {
      taskId: done.id,
      title: done.title,
      result: outcome.result ?? "",
      attempts: done.attempts,
      agent: {
        id: finishedAgent.id,
        name: finishedAgent.name,
        role: finishedAgent.role,
        status: finishedAgent.status,
        provider: finishedAgent.provider,
        model: finishedAgent.model,
        genomeId: finishedAgent.genomeId,
      },
    },
  });
  await emit(ctrl, run, "AGENT_COMPLETED", {
    actorType: "agent",
    actorId: agent.id,
    summary: `${agent.name} finished (${agent.provider}/${agent.model})`,
    payload: { agentId: agent.id },
  });
  await recordRunOutcome(agent.id, {
    success: true,
    latencyMs: latencyMsTotal,
    costUsd: finishedAgent.costUsd,
    taskCategory: planTask?.taskType ?? "general",
  });
}

async function handleTaskFailure(
  ctrl: RunControl,
  run: AgentRun & { project: { workspaceId: string } },
  agent: Agent,
  task: Task,
  planTask: PlanTask | undefined,
  error: string,
  retryable: boolean,
  latencyMsTotal: number,
  spawnRecruitForRole: (role: string, taskType: TaskProfile["taskType"], reason: string) => Promise<void>,
): Promise<void> {
  const attempts = task.attempts + 1;
  const freshAgent = agent.id === "system" ? null : await db.agent.findUnique({ where: { id: agent.id } });
  const updateFailedAgent = async (summaryText: string) => {
    if (!freshAgent) return; // loop-detection path has no real agent row
    await db.agent.update({
      where: { id: agent.id },
      data: { status: "failed", endedAt: new Date(), summary: summaryText },
    });
  };

  if (retryable && attempts < task.maxAttempts) {
    // Exponential backoff requeue: 1s, 2s, 4s … capped at 15s.
    const backoffMs = Math.min(1000 * 2 ** (attempts - 1), 15_000);
    await db.task.update({
      where: { id: task.id },
      data: { status: "pending", agentId: null, attempts, error, startedAt: null },
    });
    await updateFailedAgent(`Failed: ${error.slice(0, 120)}`);
    await emit(ctrl, run, "TASK_RETRIED", {
      actorType: "coordinator",
      summary: `Retrying "${task.title}" (attempt ${attempts + 1}/${task.maxAttempts}) after ${backoffMs / 1000}s`,
      payload: { taskId: task.id, attempts, maxAttempts: task.maxAttempts, backoffMs, error },
    });
    await emit(ctrl, run, "AGENT_FAILED", {
      actorType: "agent",
      actorId: agent.id,
      summary: `${agent.name} failed attempt ${attempts}: ${error.slice(0, 160)}`,
      payload: { agentId: agent.id, taskId: task.id, error },
    });
    await sleep(backoffMs, ctrl.abort.signal);
    return;
  }

  // Permanently failed.
  await db.task.update({
    where: { id: task.id },
    data: { status: "failed", attempts, error, endedAt: new Date() },
  });
  await updateFailedAgent(`Failed: ${error.slice(0, 120)}`);
  await emit(ctrl, run, "TASK_FAILED", {
    actorType: "agent",
    actorId: agent.id,
    summary: `"${task.title}" failed permanently after ${attempts} attempt(s)`,
    payload: { taskId: task.id, attempts, error, recovery: "recruitment evaluated for replacement" },
  });
  await emit(ctrl, run, "AGENT_FAILED", {
    actorType: "agent",
    actorId: agent.id,
    summary: `${agent.name} failed: ${error.slice(0, 160)}`,
    payload: { agentId: agent.id, taskId: task.id, error },
  });
  await recordRunOutcome(agent.id, {
    success: false,
    latencyMs: latencyMsTotal,
    costUsd: freshAgent?.costUsd ?? 0,
    failurePattern: error.slice(0, 200),
    taskCategory: planTask?.taskType ?? "general",
  });

  // Evaluate a replacement for the failed role (best effort, cap-respecting).
  try {
    const decision = await evaluateRecruitment(run.id);
    if (decision.action === "recruit") {
      const count = await db.agent.count({ where: { runId: run.id, status: { notIn: ["removed"] } } });
      if (count < run.maxAgents) {
        await spawnRecruitForRole(decision.role, decision.taskType, decision.reason);
      }
    } else if (decision.action === "retire" || decision.action === "merge") {
      await db.agent.update({ where: { id: decision.agentId }, data: { status: "removed" } });
      await emit(ctrl, run, "AGENT_REMOVED", {
        actorType: "coordinator",
        summary: decision.reason,
        payload: { agentId: decision.agentId, policy: decision.action },
      });
    }
  } catch (err) {
    console.error(`[engine] recruitment after failure failed:`, errorMessage(err));
  }
}

/** The step loop for one agent working one task. Resolves when the task ends. */
async function runAgentTaskLoop(
  ctrl: RunControl,
  run: AgentRun & { project: { workspaceId: string } },
  agent: Agent,
  connectionId: string,
  task: Task,
  planTask: PlanTask | undefined,
  spawnRecruitForRole: (role: string, taskType: TaskProfile["taskType"], reason: string) => Promise<void>,
): Promise<void> {
  const workspaceId = run.project.workspaceId;
  let latencyMsTotal = 0;
  let lastModelError: string | null = null;
  let errorStreak = 0;
  // Conversation carried across this task's steps so multi-step providers can
  // make progress (the deterministic mock rotates its action sequence by
  // conversation position).
  const history: ChatMessage[] = [];

  for (let step = 0; step < MAX_STEPS_PER_TASK; step++) {
    if (ctrl.abort.signal.aborted) return;

    // Assignment guard: if the task was requeued/retried/stopped elsewhere
    // (retryTask, loop detection), this stale loop exits immediately.
    const current = await db.task.findUnique({ where: { id: task.id } });
    if (!current || current.status !== "active" || current.agentId !== agent.id) return;

    // Honor pause/stop between steps.
    if (!(await waitWhilePaused(run.id, ctrl.abort.signal))) return;

    // Budget gate BEFORE every model call (SPEC §4.6/§7: no silent overflow).
    const budget = await checkRunBudget(run.id).catch(() => ({ ok: true } as { ok: boolean; reason?: string }));
    const freshRun = await getRun(run.id);
    if (!ctrl.budgetWarningSent && freshRun.budgetUsd > 0 && freshRun.costUsd >= BUDGET_WARNING_THRESHOLD * freshRun.budgetUsd) {
      ctrl.budgetWarningSent = true;
      await emit(ctrl, run, "BUDGET_WARNING", {
        actorType: "system",
        summary: `Run at ${Math.round((freshRun.costUsd / freshRun.budgetUsd) * 100)}% of its $${freshRun.budgetUsd} budget`,
        payload: { costUsd: freshRun.costUsd, budgetUsd: freshRun.budgetUsd, tokensUsed: freshRun.tokensUsed, tokenLimit: freshRun.tokenLimit },
      });
    }
    if (!budget.ok) {
      if (!ctrl.budgetExceededActive) {
        ctrl.budgetExceededActive = true;
        await emit(ctrl, run, "BUDGET_EXCEEDED", {
          actorType: "system",
          summary: `Budget exceeded (${budget.reason ?? "limit reached"}) — run paused`,
          payload: { reason: budget.reason ?? "budget", costUsd: freshRun.costUsd, budgetUsd: freshRun.budgetUsd, tokensUsed: freshRun.tokensUsed, tokenLimit: freshRun.tokenLimit },
        });
        await setRunStatus(run.id, "paused");
        await emit(ctrl, run, "RUN_PAUSED", {
          actorType: "system",
          summary: "Run paused: budget exceeded. Raise the budget and resume.",
          payload: { reason: "budget_exceeded" },
        });
      }
      if (!(await waitWhilePaused(run.id, ctrl.abort.signal))) return;
      ctrl.budgetExceededActive = false;
      continue; // re-check after resume
    }

    let stepResult;
    try {
      const context = await buildAgentContext({
        workspaceId,
        projectId: run.projectId,
        runId: run.id,
        agentId: agent.id,
        task: {
          id: task.id,
          title: task.title,
          description: task.description + (lastModelError ? `\n\nPrevious step error: ${lastModelError}` : ""),
          taskType: planTask?.taskType ?? "general",
        },
      });
      stepResult = await runAgentStep({
        workspaceId,
        projectId: run.projectId,
        runId: run.id,
        agent: {
          id: agent.id,
          name: agent.name,
          role: agent.role,
          provider: agent.provider,
          model: agent.model,
          connectionId,
          genomeId: agent.genomeId,
        },
        task: {
          id: task.id,
          title: task.title,
          description: task.description,
          taskType: planTask?.taskType ?? "general",
        },
        context,
        history,
        signal: ctrl.abort.signal,
      });
      lastModelError = null;
      errorStreak = 0;
      // Append the validated action as this conversation's assistant turn.
      history.push({ role: "assistant", content: JSON.stringify(stepResult.action) });
      if (history.length > 8) history.splice(0, history.length - 8);
    } catch (err) {
      if (ctrl.abort.signal.aborted) return;
      lastModelError = errorMessage(err);
      errorStreak += 1;
      // Model/validation errors feed back into context; after 3 consecutive
      // broken steps we give the task up as failed (retryable).
      if (errorStreak >= 3) {
        await handleTaskFailure(
          ctrl, run, agent, task, planTask,
          lastModelError, true, latencyMsTotal, spawnRecruitForRole,
        );
        return;
      }
      await sleep(500, ctrl.abort.signal);
      continue;
    }

    latencyMsTotal += stepResult.latencyMs;

    const outcome = await applyAction(ctrl, run, agent, task, stepResult.action, spawnRecruitForRole);
    if (outcome.wroteFile || outcome.taskDone) ctrl.iterationsSinceProgress = 0;

    if (outcome.taskDone) {
      await completeTaskSuccess(ctrl, run, agent, task, planTask, outcome, latencyMsTotal);
      return;
    }
    if (outcome.taskFailed) {
      await handleTaskFailure(
        ctrl, run, agent, task, planTask,
        outcome.failureError ?? "task_failed action",
        outcome.failureRetryable ?? true,
        latencyMsTotal,
        spawnRecruitForRole,
      );
      return;
    }
  }

  // Step cap exceeded — treat as failure (retryable; a fresh agent may do better).
  await handleTaskFailure(
    ctrl, run, agent, task, planTask,
    `Agent exceeded ${MAX_STEPS_PER_TASK} steps without completing the task.`,
    true, latencyMsTotal, spawnRecruitForRole,
  );
}

// ─────────────────────────────────────────────────────────────
// Planning phase
// ─────────────────────────────────────────────────────────────
/**
 * Rewrite plan task ids with a run-scoped prefix. Task rows use the plan id
 * as their primary key, and plan ids are only unique within a plan — without
 * a run prefix, a fork (or two runs sharing a deterministic planner) would
 * collide on Task.id. Everything downstream (Task rows, events, TaskGraph,
 * snapshots, recruitment) sees only the remapped ids, so they stay in one
 * consistent id space.
 */
function remapPlanTaskIds(plan: PlanContent, runId: string): PlanContent {
  const prefix = `${runId.slice(0, 6)}_`;
  return {
    ...plan,
    tasks: plan.tasks.map((t) => ({
      ...t,
      id: `${prefix}${t.id}`,
      dependsOn: t.dependsOn.map((d) => `${prefix}${d}`),
    })),
  };
}

async function ensurePlan(
  ctrl: RunControl,
  run: AgentRun & { project: { workspaceId: string } },
): Promise<{ plan: PlanContent; planRowId: string; mode: PlanMode; planJustCreated: boolean }> {
  const input = ctrl.input;

  const existingPlan = await db.plan.findFirst({
    where: { runId: run.id },
    orderBy: { createdAt: "desc" },
  });
  // Mode comes from the persisted Plan row when present so crash recovery
  // (which re-kicks loops without the original input) cannot accidentally
  // turn a plan_approve run into an auto run.
  const mode: PlanMode =
    (existingPlan?.mode as PlanMode | undefined) ?? input?.mode ?? "auto";
  let plan: PlanContent;
  let planRowId: string;
  let planJustCreated = false;

  if (existingPlan) {
    plan = planContentSchema.parse(fromJson(existingPlan.contentJson, {}));
    planRowId = existingPlan.id;
  } else {
    await setRunStatus(run.id, "planning", { startedAt: new Date() });
    plan = remapPlanTaskIds(
      input?.planOverride
        ? planContentSchema.parse(input.planOverride)
        : await generatePlan(run.project.workspaceId, run.goal, {
            instructionOverride: input?.instructionOverride,
            projectId: run.projectId,
            runId: run.id,
          }),
      run.id,
    );

    const graph = new TaskGraph(plan.tasks);
    if (graph.hasCycle()) {
      throw new OrchestratorError("plan_invalid", "Planner produced a cyclic task graph.");
    }

    const row = await db.plan.create({
      data: {
        projectId: run.projectId,
        runId: run.id,
        goal: run.goal,
        summary: plan.summary,
        contentJson: toJson(plan),
        status: "awaiting_approval",
        mode,
      },
    });
    planRowId = row.id;
    planJustCreated = true;
    await emit(ctrl, run, "PLAN_CREATED", {
      actorType: "coordinator",
      summary: `Plan ready: ${plan.tasks.length} tasks — ${plan.summary.slice(0, 140)}`,
      payload: { planId: row.id, plan },
    });
  }

  // Create task rows idempotently. Task row id == plan task id so dependsJson
  // and the TaskGraph share one id space.
  for (const t of plan.tasks) {
    const existing = await db.task.findUnique({ where: { id: t.id } });
    if (existing) continue;
    await db.task.create({
      data: {
        id: t.id,
        runId: run.id,
        title: t.title,
        description: t.description,
        status: "pending",
        dependsJson: toJson(t.dependsOn),
        maxAttempts: ctrl.input?.limits?.maxRetries ?? DEFAULT_LIMITS.maxRetries ?? 3,
      },
    });
    await emit(ctrl, run, "TASK_CREATED", {
      actorType: "coordinator",
      summary: `Task: ${t.title} (${t.role})`,
      payload: {
        taskId: t.id,
        title: t.title,
        role: t.role,
        taskType: t.taskType,
        dependsOn: t.dependsOn,
        parallelizable: t.parallelizable,
      },
    });
  }

  return { plan, planRowId, mode, planJustCreated };
}

/** Wait for the user's plan decision (plan_approve / resumed plan_only runs). */
async function waitForPlanDecision(
  ctrl: RunControl,
  run: AgentRun & { project: { workspaceId: string } },
  planRowId: string,
): Promise<boolean> {
  for (;;) {
    if (ctrl.abort.signal.aborted) return false;
    const row = await db.plan.findUnique({ where: { id: planRowId } });
    const runRow = await getRun(run.id);
    if (runRow.status === "stopped") return false;
    if (row?.status === "approved" || row?.status === "executing" || row?.status === "completed") {
      await db.plan.update({ where: { id: planRowId }, data: { status: "executing" } });
      await setRunStatus(run.id, "running");
      return true;
    }
    if (row?.status === "rejected") return false;
    await sleep(POLL_MS, ctrl.abort.signal);
  }
}

// ─────────────────────────────────────────────────────────────
// Execution phase (main loop)
// ─────────────────────────────────────────────────────────────
function taskSets(tasks: Task[]) {
  const completed = new Set<string>();
  const active = new Set<string>();
  const failed = new Set<string>();
  for (const t of tasks) {
    if (t.status === "completed") completed.add(t.id);
    else if (t.status === "active") active.add(t.id);
    else if (t.status === "failed" || t.status === "cancelled") failed.add(t.id);
  }
  return { completed, active, failed };
}

async function finalizeRun(
  ctrl: RunControl,
  run: AgentRun & { project: { workspaceId: string } },
): Promise<void> {
  const tasks = await db.task.findMany({ where: { runId: run.id } });
  const lines = tasks
    .filter((t) => t.status === "completed")
    .map((t) => `- ${t.title}: ${(t.result ?? "").slice(0, 300)}`);
  const summary = [
    `Goal: ${run.goal}`,
    `Completed ${lines.length}/${tasks.length} tasks.`,
    "",
    ...lines,
  ].join("\n");

  await saveMemory({
    workspaceId: run.project.workspaceId,
    projectId: run.projectId,
    runId: run.id,
    scope: "run",
    key: "final_summary",
    content: summary.slice(0, 8000),
  });
  await db.artifact.create({
    data: {
      projectId: run.projectId,
      runId: run.id,
      name: "Run summary",
      kind: "report",
      content: summary,
      metadataJson: toJson({ tasksCompleted: lines.length, tasksTotal: tasks.length }),
    },
  });
  await setRunStatus(run.id, "completed", { endedAt: new Date() });
  await db.plan.updateMany({ where: { runId: run.id }, data: { status: "completed" } });
  await emit(ctrl, run, "RUN_COMPLETED", {
    actorType: "coordinator",
    summary: `Run completed: ${lines.length}/${tasks.length} tasks done`,
    payload: { tasksCompleted: lines.length, tasksTotal: tasks.length },
  });
}

async function runLoop(runId: string): Promise<void> {
  const ctrl = controllers().get(runId);
  if (!ctrl) return;
  const signal = ctrl.abort.signal;

  try {
    const run = (await db.agentRun.findUnique({
      where: { id: runId },
      include: { project: { select: { workspaceId: true } } },
    })) as (AgentRun & { project: { workspaceId: string } }) | null;
    if (!run) return;

    await seedDefaultGenomes(run.project.workspaceId).catch(() => undefined);

    // ── Planning ──
    const { plan, planRowId, mode, planJustCreated } = await ensurePlan(ctrl, run);
    await maybeAutoCheckpoint(ctrl, runId);

    if (mode === "plan_only" && planJustCreated && !signal.aborted) {
      // Stop here, fully resumable: resumeRun re-kicks the loop which then
      // (plan already persisted → not "just created") waits for the plan
      // decision and executes.
      await db.plan.update({ where: { id: planRowId }, data: { status: "awaiting_approval" } });
      await setRunStatus(runId, "awaiting_approval");
      const cp = await createCheckpoint(runId, "plan_ready");
      await emitEvent({
        runId,
        projectId: run.projectId,
        type: "CHECKPOINT_CREATED",
        summary: "Plan ready — run paused for review (resumable)",
        payload: { checkpointId: cp.id, label: "plan_ready", eventSeq: cp.eventSeq },
      });
      return;
    }

    if (mode !== "auto" || (await getRun(runId)).status === "awaiting_approval") {
      await setRunStatus(runId, "awaiting_approval");
      const approved = await waitForPlanDecision(ctrl, run, planRowId);
      if (!approved) {
        const row = await db.plan.findUnique({ where: { id: planRowId } });
        if (row?.status === "rejected" && !signal.aborted) {
          await setRunStatus(runId, "stopped", { endedAt: new Date() });
          await emit(ctrl, run, "RUN_STOPPED", {
            actorType: "system",
            summary: "Run stopped: plan was rejected",
            payload: { reason: "plan_rejected" },
          });
        }
        return;
      }
    } else {
      await setRunStatus(runId, "running", { startedAt: (await getRun(runId)).startedAt ?? new Date() });
    }

    // ── Execution ──
    const planTaskById = new Map<string, PlanTask>(plan.tasks.map((t) => [t.id, t]));
    const maxConcurrent = ctrl.input?.limits?.maxConcurrentAgents ?? DEFAULT_LIMITS.maxConcurrentAgents ?? 4;
    const inFlight = new Map<string, Promise<void>>(); // taskId → agent loop promise
    const startedAtMs = ((await getRun(runId)).startedAt ?? new Date()).getTime();
    let nameIndex = await db.agent.count({ where: { runId } });

    const spawnRecruitForRole = async (
      role: string,
      taskType: TaskProfile["taskType"],
      reason: string,
    ): Promise<void> => {
      const tasks = await db.task.findMany({ where: { runId } });
      const sets = taskSets(tasks);
      const graph = new TaskGraph(plan.tasks);
      const target = graph
        .readyTasks(sets.completed, sets.active, sets.failed)
        .find((t) => !inFlight.has(t.id) && !(tasks.find((r) => r.id === t.id)?.agentId));
      const taskRow = target ? tasks.find((r) => r.id === target.id)! : undefined;
      const pseudoTask: Task | undefined = taskRow;
      if (!pseudoTask) {
        // No assignable work right now — still record the recruited agent as idle.
        const count = await db.agent.count({ where: { runId, status: { notIn: ["removed"] } } });
        if (count >= run.maxAgents) return;
        return;
      }
      await spawnForTask(pseudoTask, { recruited: true, recruitReason: reason });
    };

    const spawnForTask = async (
      taskRow: Task,
      opts: { recruited?: boolean; recruitReason?: string } = {},
    ): Promise<void> => {
      const planTask = planTaskById.get(taskRow.id);
      const { agent, connectionId } = await provisionAgent(ctrl, run, taskRow, planTask, {
        recruited: opts.recruited,
        nameIndex: nameIndex++,
        forceModel: ctrl.input && "forceModel" in ctrl.input
          ? (ctrl.input as unknown as { forceModel?: { provider: string; model: string } }).forceModel
          : undefined,
      });
      await db.task.update({
        where: { id: taskRow.id },
        data: { status: "active", agentId: agent.id, startedAt: new Date() },
      });
      await db.agent.update({ where: { id: agent.id }, data: { status: "active" } });
      await emit(ctrl, run, "TASK_STARTED", {
        actorType: "coordinator",
        actorId: agent.id,
        summary: `${agent.name} started "${taskRow.title}"`,
        payload: { taskId: taskRow.id, agentId: agent.id, attempts: taskRow.attempts },
      });
      await emit(ctrl, run, "AGENT_STARTED", {
        actorType: "agent",
        actorId: agent.id,
        summary: `${agent.name} is working on "${taskRow.title}"`,
        payload: { agentId: agent.id, taskId: taskRow.id },
      });
      const promise = runAgentTaskLoop(
        ctrl, run, agent, connectionId,
        { ...taskRow, status: "active", agentId: agent.id },
        planTask, spawnRecruitForRole,
      )
        .catch((err) => {
          // Last-resort guard: a step loop must never take the engine down.
          console.error(`[engine] agent loop crashed (run ${runId}, task ${taskRow.id}):`, errorMessage(err));
        })
        .finally(() => {
          inFlight.delete(taskRow.id);
        });
      inFlight.set(taskRow.id, promise);
    };

    for (;;) {
      if (signal.aborted) return;

      const runRow = await getRun(runId);
      if (runRow.status === "stopped" || runRow.status === "failed" || runRow.status === "completed") {
        return;
      }
      if (runRow.status === "paused") {
        // Checkpoint once on entering pause, then wait it out.
        await maybeAutoCheckpoint(ctrl, runId);
        if (!(await waitWhilePaused(runId, signal))) return;
        continue;
      }
      if (runRow.status === "awaiting_approval") {
        // Approval flows inside agent loops move the status back to running.
        await sleep(POLL_MS, signal);
        continue;
      }

      // Time limit guard.
      if (Date.now() - startedAtMs > runRow.timeLimitSec * 1000) {
        throw new OrchestratorError("time_limit_exceeded", `Run exceeded its ${runRow.timeLimitSec}s time limit.`);
      }

      const tasks = await db.task.findMany({ where: { runId } });
      const sets = taskSets(tasks);
      const graph = new TaskGraph(plan.tasks);

      if (graph.isComplete(sets.completed)) {
        await Promise.allSettled([...inFlight.values()]);
        await finalizeRun(ctrl, run);
        return;
      }

      // Dead-end detection: no work running, nothing ready, but incomplete.
      const ready = graph.readyTasks(sets.completed, sets.active, sets.failed);
      if (ready.length === 0 && inFlight.size === 0) {
        const remaining = plan.tasks.filter(
          (t) => !sets.completed.has(t.id) && !sets.failed.has(t.id),
        );
        if (remaining.length === 0) {
          // Only failed tasks remain and nothing can proceed.
          throw new OrchestratorError(
            "tasks_failed",
            "Run cannot continue: all remaining tasks failed permanently.",
          );
        }
        // Cancel tasks doomed by failed dependencies.
        for (const t of remaining) {
          await db.task.update({ where: { id: t.id }, data: { status: "cancelled", error: "dependency_failed", endedAt: new Date() } });
          await emit(ctrl, run, "TASK_FAILED", {
            actorType: "coordinator",
            summary: `"${t.title}" cancelled: a dependency failed permanently`,
            payload: { taskId: t.id, error: "dependency_failed" },
          });
        }
        throw new OrchestratorError(
          "tasks_failed",
          "Run cannot continue: dependencies of remaining tasks failed.",
        );
      }

      // Spawn agents for ready tasks (semaphore: maxConcurrent; cap maxAgents).
      const agentCount = await db.agent.count({ where: { runId, status: { notIn: ["removed"] } } });
      let spawned = false;
      let spawnedThisPass = 0;
      for (const pt of ready) {
        if (inFlight.size >= maxConcurrent) break;
        if (inFlight.has(pt.id)) continue;
        const row = tasks.find((t) => t.id === pt.id);
        if (!row || row.agentId) continue;
        if (agentCount + spawnedThisPass >= runRow.maxAgents) break;
        await spawnForTask(row);
        spawned = true;
        spawnedThisPass += 1;
        ctrl.iterationsSinceProgress = 0;
      }

      // Loop detection: too many iterations with no completion and no write.
      ctrl.iterationsSinceProgress += 1;
      if (ctrl.iterationsSinceProgress > LOOP_DETECTION_LIMIT) {
        ctrl.iterationsSinceProgress = 0;
        const stuck = tasks.find((t) => t.status === "active");
        if (stuck) {
          const agent = stuck.agentId
            ? await db.agent.findUnique({ where: { id: stuck.agentId } })
            : null;
          inFlight.delete(stuck.id);
          await handleTaskFailure(
            ctrl, run,
            agent ?? ({ id: "system", name: "coordinator", runId, role: "coordinator", provider: "", model: "", status: "failed", genomeId: null, summary: "", confidence: 0, recruited: false, tokensIn: 0, tokensOut: 0, costUsd: 0, createdAt: new Date(), endedAt: null } as unknown as Agent),
            stuck,
            planTaskById.get(stuck.id),
            `Loop detection: no task completed and no file written for ${LOOP_DETECTION_LIMIT} consecutive engine iterations (recovery).`,
            true,
            0,
            spawnRecruitForRole,
          );
        }
      }

      await maybeAutoCheckpoint(ctrl, runId);

      if (!spawned) {
        if (inFlight.size > 0) {
          await Promise.race([...inFlight.values(), sleep(IDLE_POLL_MS, signal)]);
        } else {
          await sleep(IDLE_POLL_MS, signal);
        }
      }
    }
  } catch (err) {
    if (ctrl.abort.signal.aborted) return; // stop requested — stopRun owns the event
    const message = errorMessage(err);
    console.error(`[engine] run ${runId} failed:`, message);
    try {
      await db.agentRun.update({
        where: { id: runId },
        data: { status: "failed", error: message, endedAt: new Date() },
      });
      const runRow = await getRun(runId);
      await emitEvent({
        runId,
        projectId: runRow.projectId,
        type: "RUN_FAILED",
        summary: `Run failed: ${message}`,
        payload: { error: message, code: err instanceof OrchestratorError ? err.code : "internal" },
      });
    } catch (inner) {
      console.error(`[engine] could not record RUN_FAILED for ${runId}:`, errorMessage(inner));
    }
  } finally {
    // Only remove ourselves if we are still the registered controller
    // (a fork/resume may have replaced us).
    if (controllers().get(runId) === ctrl) controllers().delete(runId);
  }
}

/** Register a controller and kick the loop (never awaited by callers). */
function kickLoop(runId: string, input?: StartRunInput & { workspaceId: string }): void {
  const existing = controllers().get(runId);
  if (existing) {
    if (input) existing.input = { ...existing.input, ...input };
    return; // loop already running — serialized per run
  }
  const ctrl: RunControl = {
    abort: new AbortController(),
    input,
    emittedSinceCheckpoint: 0,
    budgetWarningSent: false,
    budgetExceededActive: false,
    iterationsSinceProgress: 0,
  };
  controllers().set(runId, ctrl);
  void runLoop(runId);
}

// ─────────────────────────────────────────────────────────────
// Public API (SPEC §4.6)
// ─────────────────────────────────────────────────────────────
export async function startRun(
  input: StartRunInput & { workspaceId: string },
): Promise<{ runId: string }> {
  const project = await db.project.findUnique({ where: { id: input.projectId } });
  if (!project || project.workspaceId !== input.workspaceId) {
    throw new OrchestratorError("project_not_found", `Project ${input.projectId} not found in this workspace.`);
  }
  if (!input.goal.trim()) {
    throw new OrchestratorError("goal_required", "A run needs a non-empty goal.");
  }

  const limits = { ...DEFAULT_LIMITS, ...(input.limits ?? {}) };
  const run = await db.agentRun.create({
    data: {
      projectId: project.id,
      goal: input.goal,
      status: "queued",
      autonomy: input.autonomy,
      budgetUsd: limits.budgetUsd,
      tokenLimit: limits.tokenLimit,
      timeLimitSec: limits.timeLimitSec,
      maxAgents: limits.maxAgents,
    },
  });

  await emitEvent({
    runId: run.id,
    projectId: project.id,
    type: "RUN_CREATED",
    actorType: "user",
    summary: `Run created (${input.mode}, autonomy ${input.autonomy}): ${input.goal.slice(0, 120)}`,
    payload: { goal: input.goal, mode: input.mode, autonomy: input.autonomy, limits },
  });

  kickLoop(run.id, input);
  return { runId: run.id };
}

export async function pauseRun(runId: string): Promise<void> {
  const run = await getRun(runId);
  if (run.status !== "running" && run.status !== "planning") return;
  await setRunStatus(runId, "paused");
  await emitEvent({
    runId,
    projectId: run.projectId,
    type: "RUN_PAUSED",
    actorType: "user",
    summary: "Run paused",
    payload: {},
  });
  // Checkpoint on pause so the exact pause point is restorable/forkable.
  try {
    const cp = await createCheckpoint(runId, "pause");
    await emitEvent({
      runId,
      projectId: run.projectId,
      type: "CHECKPOINT_CREATED",
      summary: `Checkpoint on pause at event ${cp.eventSeq}`,
      payload: { checkpointId: cp.id, label: "pause", eventSeq: cp.eventSeq },
    });
  } catch (err) {
    console.error(`[engine] pause checkpoint failed for ${runId}:`, errorMessage(err));
  }
}

export async function resumeRun(runId: string): Promise<void> {
  const run = await getRun(runId);
  if (run.status !== "paused" && run.status !== "awaiting_approval") return;
  await setRunStatus(runId, "running");
  await emitEvent({
    runId,
    projectId: run.projectId,
    type: "RUN_RESUMED",
    actorType: "user",
    summary: "Run resumed",
    payload: {},
  });
  // If the loop is not alive (plan_only stop, server restart), re-kick it.
  if (!controllers().has(runId)) kickLoop(runId);
}

export async function stopRun(runId: string): Promise<void> {
  const run = await getRun(runId);
  if (run.status === "completed" || run.status === "failed" || run.status === "stopped") return;
  const ctrl = controllers().get(runId);
  ctrl?.abort.abort();
  controllers().delete(runId);
  await setRunStatus(runId, "stopped", { endedAt: new Date() });
  await db.agent.updateMany({
    where: { runId, status: { in: ["idle", "active", "waiting", "paused"] } },
    data: { status: "removed", endedAt: new Date() },
  });
  await emitEvent({
    runId,
    projectId: run.projectId,
    type: "RUN_STOPPED",
    actorType: "user",
    summary: "Run stopped",
    payload: {},
  });
}

export async function retryTask(runId: string, taskId: string): Promise<void> {
  const run = await getRun(runId);
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task || task.runId !== runId) {
    throw new OrchestratorError("task_not_found", `Task ${taskId} not found in run ${runId}.`);
  }
  await db.task.update({
    where: { id: taskId },
    data: { status: "pending", agentId: null, attempts: 0, error: null, result: null, startedAt: null, endedAt: null },
  });
  await emitEvent({
    runId,
    projectId: run.projectId,
    type: "TASK_RETRIED",
    actorType: "user",
    summary: `Task "${task.title}" manually requeued`,
    payload: { taskId, attempts: 0, manual: true },
  });
  if (run.status === "failed" || run.status === "stopped" || run.status === "completed") {
    await setRunStatus(runId, "running", { endedAt: null });
    await emitEvent({
      runId,
      projectId: run.projectId,
      type: "RUN_RESUMED",
      actorType: "user",
      summary: "Run resumed to retry a task",
      payload: { reason: "retry_task", taskId },
    });
  }
  if (!controllers().has(runId)) kickLoop(runId);
}

export async function forkRun(
  runId: string,
  opts: {
    checkpointId?: string;
    instructionOverride?: string;
    forceModel?: { provider: string; model: string };
  },
): Promise<{ runId: string }> {
  const source = await db.agentRun.findUnique({
    where: { id: runId },
    include: { project: { select: { workspaceId: true } } },
  });
  if (!source) throw new OrchestratorError("run_not_found", `Run ${runId} not found.`);

  // Snapshot: requested checkpoint → latest checkpoint → fold the event log.
  let snapshot: RunSnapshot;
  if (opts.checkpointId) {
    snapshot = await restoreSnapshot(runId, opts.checkpointId);
  } else {
    const latest = await latestCheckpoint(runId);
    if (latest) {
      snapshot = await restoreSnapshot(runId, latest.id);
    } else {
      const events = await listEvents({ runId, limit: 10_000 });
      snapshot = reconstructRunState(events);
      snapshot.runId = runId;
    }
  }

  const fork = await db.agentRun.create({
    data: {
      projectId: source.projectId,
      goal: snapshot.goal || source.goal,
      status: "queued",
      autonomy: source.autonomy,
      branchOfId: runId,
      budgetUsd: source.budgetUsd,
      tokenLimit: source.tokenLimit,
      timeLimitSec: source.timeLimitSec,
      maxAgents: source.maxAgents,
    },
  });

  await emitEvent({
    runId: fork.id,
    projectId: fork.projectId,
    type: "RUN_FORKED",
    actorType: "user",
    summary: `Forked from run ${runId.slice(0, 8)} at event ${snapshot.eventSeq}${opts.instructionOverride ? " with new instructions" : ""}`,
    payload: {
      sourceRunId: runId,
      checkpointId: opts.checkpointId ?? null,
      eventSeq: snapshot.eventSeq,
      instructionOverride: opts.instructionOverride ?? null,
      goal: fork.goal,
    },
  });

  if (!opts.instructionOverride && snapshot.plan) {
    // Reuse the source plan: copy the plan row; task rows are recreated
    // idempotently by the loop's planning phase.
    const sourcePlan = await db.plan.findFirst({ where: { runId }, orderBy: { createdAt: "desc" } });
    // Re-prefix task ids for the fork so its Task rows can't collide with the
    // source run's rows (Task.id is a global primary key).
    const plan = remapPlanTaskIds(planContentSchema.parse(snapshot.plan), fork.id);
    await db.plan.create({
      data: {
        projectId: fork.projectId,
        runId: fork.id,
        goal: fork.goal,
        summary: plan.summary,
        contentJson: toJson(plan),
        status: source.autonomy === "auto" || sourcePlan?.status === "approved" || sourcePlan?.status === "executing" || sourcePlan?.status === "completed"
          ? "approved"
          : "awaiting_approval",
        mode: sourcePlan?.mode ?? "auto",
      },
    });
  }

  const input: StartRunInput & { workspaceId: string } = {
    workspaceId: source.project.workspaceId,
    projectId: fork.projectId,
    goal: fork.goal,
    mode: "auto",
    autonomy: source.autonomy as StartRunInput["autonomy"],
    instructionOverride: opts.instructionOverride,
    limits: {
      budgetUsd: source.budgetUsd,
      tokenLimit: source.tokenLimit,
      timeLimitSec: source.timeLimitSec,
      maxAgents: source.maxAgents,
    },
  };
  if (opts.forceModel) {
    (input as unknown as { forceModel?: { provider: string; model: string } }).forceModel = opts.forceModel;
  }
  kickLoop(fork.id, input);
  return { runId: fork.id };
}

/**
 * Crash recovery (called from instrumentation on server start): runs left in
 * running/planning/paused by a previous process get their loops re-kicked;
 * durable state is already in the DB, checkpoints hold the last snapshot.
 */
export async function resumeInterruptedRuns(): Promise<void> {
  const stuck = await db.agentRun.findMany({
    where: { status: { in: ["running", "planning", "paused"] } },
  });
  for (const run of stuck) {
    if (controllers().has(run.id)) continue;
    try {
      if (run.status === "running" || run.status === "planning") {
        await db.agentRun.update({ where: { id: run.id }, data: { status: "running" } });
        await emitEvent({
          runId: run.id,
          projectId: run.projectId,
          type: "RUN_RESUMED",
          actorType: "system",
          summary: "Recovered after server restart",
          payload: { recovered: true, previousStatus: run.status },
        });
      }
      // Paused runs get their loop back so a later resumeRun works; the loop
      // immediately parks in waitWhilePaused.
      kickLoop(run.id);
    } catch (err) {
      console.error(`[engine] failed to resume run ${run.id}:`, errorMessage(err));
    }
  }
}
