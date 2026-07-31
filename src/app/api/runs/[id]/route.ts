import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { fromJson } from "@/server/json";
import { latestCheckpoint } from "@/server/orchestrator/checkpoints";
import { HttpError, errorResponse, json, workspaceIdOf } from "@/app/api/_utils";

export const runtime = "nodejs";

/** Full run detail: run row, parsed plan, agents, tasks, approvals,
 *  checkpoints, cost — everything the agentic workspace needs (SPEC §5). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;

    const run = await db.agentRun.findFirst({
      where: { id, project: { workspaceId } },
      include: {
        _count: { select: { agents: true, tasks: true, events: true } },
        project: { select: { name: true } },
      },
    });
    if (!run) throw new HttpError(404, "Run not found");

    const [planRow, agents, tasks, approvals, latest, checkpoints, forks] = await Promise.all([
      db.plan.findFirst({ where: { runId: id }, orderBy: { createdAt: "desc" } }),
      db.agent.findMany({ where: { runId: id }, orderBy: { createdAt: "asc" } }),
      db.task.findMany({ where: { runId: id }, orderBy: { createdAt: "asc" } }),
      db.approval.findMany({ where: { runId: id }, orderBy: { createdAt: "desc" } }),
      latestCheckpoint(id),
      db.checkpoint.findMany({
        where: { runId: id },
        orderBy: { eventSeq: "desc" },
        select: { id: true, runId: true, label: true, eventSeq: true, createdAt: true },
      }),
      db.agentRun.findMany({
        where: { branchOfId: id },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, goal: true, createdAt: true },
      }),
    ]);

    const checkpointDto = (c: { id: string; runId: string; label: string; eventSeq: number; createdAt: Date }) => ({
      id: c.id,
      runId: c.runId,
      label: c.label,
      eventSeq: c.eventSeq,
      createdAt: c.createdAt,
    });

    return json({
      run,
      plan: planRow
        ? { ...planRow, contentJson: fromJson<unknown>(planRow.contentJson, null) }
        : null,
      agents,
      tasks: tasks.map((t) => ({ ...t, dependsJson: fromJson<string[]>(t.dependsJson, []) })),
      approvals: approvals.map((a) => ({
        ...a,
        detailJson: fromJson<unknown>(a.detailJson, {}),
      })),
      latestCheckpoint: latest ? checkpointDto(latest) : null,
      checkpoints: checkpoints.map(checkpointDto),
      forks,
      cost: run.costUsd,
      eventsCount: run._count.events,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
