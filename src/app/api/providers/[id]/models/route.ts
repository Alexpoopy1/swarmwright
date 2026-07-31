import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { listConnectionModels } from "@/server/providers/registry";
import { HttpError, errorResponse, json, workspaceIdOf } from "@/app/api/_utils";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    const row = await db.providerConnection.findUnique({ where: { id } });
    if (!row || row.workspaceId !== workspaceId) throw new HttpError(404, "Connection not found");

    const models = await listConnectionModels(id);
    return json({ models });
  } catch (err) {
    return errorResponse(err);
  }
}
