import { z } from "zod";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { emitEvent } from "@/server/events/store";
import {
  HttpError,
  errorResponse,
  json,
  parseBody,
  workspaceIdOf,
} from "@/app/api/_utils";

export const runtime = "nodejs";

const bodySchema = z.object({
  decision: z.enum(["approve", "reject"]),
});

/**
 * Plan approval gate (SPEC §5). For `plan_approve` runs the engine polls the
 * plan/run rows, so approving only needs to flip the rows + emit events —
 * the engine picks the run back up from there.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    const plan = await db.plan.findUnique({ where: { id } });
    if (!plan) throw new HttpError(404, "Plan not found");
    const run = plan.runId
      ? await db.agentRun.findUnique({
          where: { id: plan.runId },
          select: { id: true, status: true, project: { select: { workspaceId: true } } },
        })
      : null;
    const ownerWorkspace = run
      ? run.project.workspaceId
      : (
          await db.project.findUnique({
            where: { id: plan.projectId ?? "" },
            select: { workspaceId: true },
          })
        )?.workspaceId;
    if (ownerWorkspace !== workspaceId) throw new HttpError(404, "Plan not found");

    const { decision } = await parseBody(req, bodySchema);

    if (decision === "approve") {
      const updated = await db.plan.update({ where: { id }, data: { status: "approved" } });
      await emitEvent({
        runId: plan.runId,
        projectId: plan.projectId,
        type: "PLAN_APPROVED",
        actorType: "user",
        actorId: user.id,
        summary: "Plan approved",
        payload: { planId: id },
      });
      // plan_approve mode: unpark the run; the engine loop resumes by polling.
      if (plan.mode === "plan_approve" && run && run.status === "awaiting_approval") {
        await db.agentRun.update({ where: { id: run.id }, data: { status: "running" } });
        await emitEvent({
          runId: run.id,
          projectId: plan.projectId,
          type: "RUN_RESUMED",
          actorType: "user",
          actorId: user.id,
          summary: "Run resumed after plan approval",
          payload: { planId: id },
        });
      }
      return json({ ok: true, plan: updated });
    }

    const updated = await db.plan.update({ where: { id }, data: { status: "rejected" } });
    await emitEvent({
      runId: plan.runId,
      projectId: plan.projectId,
      type: "PLAN_REJECTED",
      actorType: "user",
      actorId: user.id,
      summary: "Plan rejected",
      payload: { planId: id },
    });
    // A rejected plan_approve run has nothing left to do — stop it cleanly.
    if (plan.mode === "plan_approve" && run && run.status === "awaiting_approval") {
      await db.agentRun.update({ where: { id: run.id }, data: { status: "stopped", endedAt: new Date() } });
      await emitEvent({
        runId: run.id,
        projectId: plan.projectId,
        type: "RUN_STOPPED",
        actorType: "user",
        actorId: user.id,
        summary: "Run stopped (plan rejected)",
        payload: { planId: id },
      });
    }
    return json({ ok: true, plan: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
