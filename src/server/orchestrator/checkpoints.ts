import { db } from "@/server/db";
import { fromJson, toJson } from "@/server/json";
import { latestSeq } from "@/server/events/store";
import type { AgentStatus, PlanContent, RunSnapshot, RunStatus, TaskStatus } from "@/types";
import { OrchestratorError } from "./errors";

/**
 * Checkpoints (SPEC §4.6): durable RunSnapshot rows so runs can be resumed
 * after pause/restart and forked from any point (Time Machine).
 */

/** Build a RunSnapshot from current DB rows plus the latest event sequence. */
export async function buildSnapshot(runId: string): Promise<RunSnapshot> {
  const run = await db.agentRun.findUnique({
    where: { id: runId },
    include: { tasks: true, agents: true },
  });
  if (!run) throw new OrchestratorError("run_not_found", `Run ${runId} not found`);
  const plan = await db.plan.findFirst({
    where: { runId },
    orderBy: { createdAt: "desc" },
  });

  return {
    runId: run.id,
    status: run.status as RunStatus,
    goal: run.goal,
    plan: plan ? fromJson<PlanContent | null>(plan.contentJson, null) : null,
    taskStates: run.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status as TaskStatus,
      agentId: t.agentId,
      attempts: t.attempts,
      result: t.result,
    })),
    agentStates: run.agents.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      status: a.status as AgentStatus,
      provider: a.provider,
      model: a.model,
      genomeId: a.genomeId,
    })),
    costUsd: run.costUsd,
    tokensUsed: run.tokensUsed,
    eventSeq: await latestSeq(runId),
    createdAt: new Date().toISOString(),
  };
}

export async function createCheckpoint(runId: string, label: string): Promise<{
  id: string;
  runId: string;
  label: string;
  eventSeq: number;
  createdAt: Date;
}> {
  const snapshot = await buildSnapshot(runId);
  return db.checkpoint.create({
    data: {
      runId,
      label,
      stateJson: toJson(snapshot),
      eventSeq: snapshot.eventSeq,
    },
  });
}

export async function latestCheckpoint(runId: string) {
  return db.checkpoint.findFirst({
    where: { runId },
    orderBy: { eventSeq: "desc" },
  });
}

/** Load the snapshot stored in a checkpoint (validates it belongs to the run). */
export async function restoreSnapshot(runId: string, checkpointId: string): Promise<RunSnapshot> {
  const checkpoint = await db.checkpoint.findUnique({ where: { id: checkpointId } });
  if (!checkpoint || checkpoint.runId !== runId) {
    throw new OrchestratorError(
      "checkpoint_not_found",
      `Checkpoint ${checkpointId} not found for run ${runId}`,
    );
  }
  const snapshot = fromJson<RunSnapshot | null>(checkpoint.stateJson, null);
  if (!snapshot || snapshot.runId !== runId) {
    throw new OrchestratorError("checkpoint_invalid", `Checkpoint ${checkpointId} is corrupt`);
  }
  return snapshot;
}
