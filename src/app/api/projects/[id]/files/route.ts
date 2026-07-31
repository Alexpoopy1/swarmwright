import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { listFiles } from "@/server/projects";
import { HttpError, errorResponse, json, workspaceIdOf } from "@/app/api/_utils";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    const project = await db.project.findUnique({ where: { id } });
    if (!project || project.workspaceId !== workspaceId) {
      throw new HttpError(404, "Project not found");
    }
    const files = await listFiles(id);
    return json({ files });
  } catch (err) {
    return errorResponse(err);
  }
}
