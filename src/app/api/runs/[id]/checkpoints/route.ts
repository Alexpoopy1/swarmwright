import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { HttpError, errorResponse, json, workspaceIdOf } from "@/app/api/_utils";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id: runId } = await ctx.params;
    const run = await db.agentRun.findFirst({
      where: { id: runId, project: { workspaceId } },
      select: { id: true },
    });
    if (!run) throw new HttpError(404, "Run not found");

    const checkpoints = await db.checkpoint.findMany({
      where: { runId },
      orderBy: { eventSeq: "desc" },
      select: { id: true, runId: true, label: true, eventSeq: true, createdAt: true },
    });
    return json({ checkpoints });
  } catch (err) {
    return errorResponse(err);
  }
}
