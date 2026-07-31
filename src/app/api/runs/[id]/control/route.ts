import { z } from "zod";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { pauseRun, resumeRun, retryTask, stopRun } from "@/server/orchestrator/engine";
import {
  HttpError,
  errorResponse,
  json,
  parseBody,
  workspaceIdOf,
} from "@/app/api/_utils";

export const runtime = "nodejs";

const bodySchema = z.object({
  action: z.enum(["pause", "resume", "stop", "retry"]),
  taskId: z.string().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    const run = await db.agentRun.findFirst({
      where: { id, project: { workspaceId } },
      select: { id: true },
    });
    if (!run) throw new HttpError(404, "Run not found");

    const body = await parseBody(req, bodySchema);
    switch (body.action) {
      case "pause":
        await pauseRun(id);
        break;
      case "resume":
        await resumeRun(id);
        break;
      case "stop":
        await stopRun(id);
        break;
      case "retry":
        if (!body.taskId) throw new HttpError(400, "retry requires taskId");
        await retryTask(id, body.taskId);
        break;
    }
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
