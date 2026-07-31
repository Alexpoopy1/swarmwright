import { z } from "zod";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { forkRun } from "@/server/orchestrator/engine";
import {
  HttpError,
  errorResponse,
  json,
  parseBody,
  workspaceIdOf,
} from "@/app/api/_utils";

export const runtime = "nodejs";

const bodySchema = z.object({
  checkpointId: z.string().optional(),
  instructionOverride: z.string().max(4000).optional(),
  forceModel: z
    .object({ provider: z.string().min(1), model: z.string().min(1) })
    .optional(),
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
    const result = await forkRun(id, body);
    return json(result, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
