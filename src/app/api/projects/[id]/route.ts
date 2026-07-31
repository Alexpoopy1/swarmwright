import { z } from "zod";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { listFiles } from "@/server/projects";
import {
  HttpError,
  errorResponse,
  json,
  parseBody,
  workspaceIdOf,
} from "@/app/api/_utils";

export const runtime = "nodejs";

async function ownedProject(id: string, workspaceId: string) {
  const row = await db.project.findUnique({ where: { id } });
  if (!row || row.workspaceId !== workspaceId) throw new HttpError(404, "Project not found");
  return row;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    const project = await ownedProject(id, workspaceId);
    const [files, runs] = await Promise.all([
      listFiles(id),
      db.agentRun.findMany({
        where: { projectId: id },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);
    return json({ ...project, files, runs });
  } catch (err) {
    return errorResponse(err);
  }
}

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    await ownedProject(id, workspaceId);
    const body = await parseBody(req, patchSchema);
    const project = await db.project.update({
      where: { id },
      data: { name: body.name?.trim(), description: body.description },
    });
    return json(project);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    await ownedProject(id, workspaceId);
    await db.project.delete({ where: { id } });
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
