import { z } from "zod";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { fromJson } from "@/server/json";
import {
  HttpError,
  errorResponse,
  json,
  parseBody,
  workspaceIdOf,
} from "@/app/api/_utils";

export const runtime = "nodejs";

async function ownedTool(id: string, workspaceId: string) {
  const tool = await db.toolDefinition.findUnique({
    where: { id },
    include: { project: { select: { workspaceId: true } } },
  });
  if (!tool || tool.project.workspaceId !== workspaceId) {
    throw new HttpError(404, "Tool not found");
  }
  return tool;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    const tool = await ownedTool(id, workspaceId);
    const executions = await db.toolExecution.findMany({
      where: { toolId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const { project: _project, ...rest } = tool;
    return json({
      ...rest,
      inputSchema: fromJson<Record<string, unknown>>(tool.inputSchemaJson, {}),
      outputSchema: fromJson<Record<string, unknown>>(tool.outputSchemaJson, {}),
      permissions: fromJson<string[]>(tool.permissionsJson, []),
      audit: fromJson<unknown[]>(tool.auditJson, []),
      executions: executions.map((e) => ({
        ...e,
        input: fromJson<unknown>(e.inputJson, {}),
        output: fromJson<unknown>(e.outputJson, {}),
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

const patchSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(["draft", "pending_approval", "approved", "rejected", "archived"]).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    await ownedTool(id, workspaceId);
    const body = await parseBody(req, patchSchema);
    const updated = await db.toolDefinition.update({
      where: { id },
      data: {
        name: body.name,
        description: body.description,
        status: body.status,
      },
    });
    return json(updated);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    await ownedTool(id, workspaceId);
    await db.toolDefinition.delete({ where: { id } });
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
