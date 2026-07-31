import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { listEvents } from "@/server/events/store";
import {
  HttpError,
  errorResponse,
  json,
  queryInt,
  workspaceIdOf,
} from "@/app/api/_utils";

export const runtime = "nodejs";

/** JSON event paging for the Time Machine (`?afterSeq&limit`). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id: runId } = await ctx.params;
    const run = await db.agentRun.findFirst({
      where: { id: runId, project: { workspaceId } },
      select: { id: true },
    });
    if (!run) throw new HttpError(404, "Run not found");

    const url = new URL(req.url);
    const events = await listEvents({
      runId,
      afterSeq: queryInt(url, "afterSeq"),
      limit: queryInt(url, "limit") ?? 500,
    });
    return json({ events });
  } catch (err) {
    return errorResponse(err);
  }
}
