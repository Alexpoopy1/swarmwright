import { z } from "zod";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { emitEvent } from "@/server/events/store";
import { fromJson } from "@/server/json";
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

/** Resolve a pending approval. The engine polls the Approval row, so
 *  updating it (plus the audit event) is all that's needed. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    const approval = await db.approval.findUnique({
      where: { id },
      select: {
        id: true,
        runId: true,
        kind: true,
        title: true,
        status: true,
        run: { select: { projectId: true, project: { select: { workspaceId: true } } } },
      },
    });
    if (!approval || approval.run.project.workspaceId !== workspaceId) {
      throw new HttpError(404, "Approval not found");
    }
    if (approval.status !== "pending") {
      throw new HttpError(400, `Approval already ${approval.status}`);
    }

    const { decision } = await parseBody(req, bodySchema);
    const status = decision === "approve" ? "approved" : "rejected";
    const updated = await db.approval.update({
      where: { id },
      data: { status, decidedAt: new Date() },
    });

    await emitEvent({
      runId: approval.runId,
      projectId: approval.run.projectId,
      type: "APPROVAL_RESOLVED",
      actorType: "user",
      actorId: user.id,
      summary: `${approval.title}: ${status}`,
      payload: { approvalId: id, kind: approval.kind, decision: status },
    });

    return json({ ...updated, detailJson: fromJson<unknown>(updated.detailJson, {}) });
  } catch (err) {
    return errorResponse(err);
  }
}
