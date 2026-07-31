import { z } from "zod";
import { planContentSchema } from "@/types";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { emitEvent } from "@/server/events/store";
import { fromJson, toJson } from "@/server/json";
import {
  HttpError,
  errorResponse,
  json,
  parseBody,
  workspaceIdOf,
} from "@/app/api/_utils";

export const runtime = "nodejs";

async function ownedPlan(id: string, workspaceId: string) {
  const plan = await db.plan.findUnique({ where: { id } });
  if (!plan) throw new HttpError(404, "Plan not found");
  // Plans attach to a project and/or a run — check workspace through either.
  let ownerWorkspace: string | null = null;
  if (plan.projectId) {
    const project = await db.project.findUnique({
      where: { id: plan.projectId },
      select: { workspaceId: true },
    });
    ownerWorkspace = project?.workspaceId ?? null;
  } else if (plan.runId) {
    const run = await db.agentRun.findUnique({
      where: { id: plan.runId },
      select: { project: { select: { workspaceId: true } } },
    });
    ownerWorkspace = run?.project.workspaceId ?? null;
  }
  if (ownerWorkspace !== workspaceId) throw new HttpError(404, "Plan not found");
  return plan;
}

const planDto = (plan: { contentJson: string } & Record<string, unknown>) => ({
  ...plan,
  contentJson: fromJson<unknown>(plan.contentJson, null),
});

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    const plan = await ownedPlan(id, workspaceId);
    return json(planDto(plan));
  } catch (err) {
    return errorResponse(err);
  }
}

const patchSchema = z.object({
  /** Partial PlanContent edits, merged over the current document. */
  content: z.record(z.unknown()).optional(),
  /** Alias used by the plan editor UI. */
  contentJson: z.record(z.unknown()).optional(),
  status: z
    .enum(["draft", "awaiting_approval", "approved", "rejected", "executing", "completed"])
    .optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    const plan = await ownedPlan(id, workspaceId);
    const body = await parseBody(req, patchSchema);

    const data: Record<string, unknown> = {};
    const edits = body.content ?? body.contentJson;
    if (edits) {
      const current = fromJson<Record<string, unknown>>(plan.contentJson, {});
      // Merge partial edits, then validate the whole document — the merged
      // result must always be a schema-valid PlanContent.
      const merged = planContentSchema.safeParse({ ...current, ...edits });
      if (!merged.success) {
        const issue = merged.error.issues[0];
        const where = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
        throw new HttpError(400, `${where}${issue?.message ?? "Invalid plan content"}`);
      }
      data.contentJson = toJson(merged.data);
      data.summary = merged.data.summary;
    }
    if (body.status) data.status = body.status;

    const updated = await db.plan.update({ where: { id }, data });
    await emitEvent({
      runId: updated.runId,
      projectId: updated.projectId,
      type: "PLAN_EDITED",
      actorType: "user",
      actorId: user.id,
      summary: `Plan edited${body.status ? ` (status → ${body.status})` : ""}`,
      payload: { planId: id, status: updated.status, editedFields: edits ? Object.keys(edits) : [] },
    });
    return json(planDto(updated));
  } catch (err) {
    return errorResponse(err);
  }
}
