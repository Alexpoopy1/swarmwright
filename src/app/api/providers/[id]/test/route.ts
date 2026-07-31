import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { connectionConfig, getAdapter } from "@/server/providers/registry";
import { HttpError, errorResponse, json, workspaceIdOf } from "@/app/api/_utils";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    const row = await db.providerConnection.findUnique({ where: { id } });
    if (!row || row.workspaceId !== workspaceId) throw new HttpError(404, "Connection not found");

    let result: { ok: boolean; error?: string };
    try {
      const config = await connectionConfig(id);
      result = await getAdapter(config.provider).testConnection(config);
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : "Connection test failed" };
    }

    await db.providerConnection.update({
      where: { id },
      data: { status: result.ok ? "ok" : "failed", lastCheckedAt: new Date() },
    });
    return json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
