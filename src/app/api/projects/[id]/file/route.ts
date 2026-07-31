import { z } from "zod";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { PathSafetyError, getFile, upsertFile } from "@/server/projects";
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

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    await ownedProject(id, workspaceId);
    const path = new URL(req.url).searchParams.get("path");
    if (!path) throw new HttpError(400, "path query parameter is required");
    const file = await getFile(id, path);
    if (!file) throw new HttpError(404, `File not found: ${path}`);
    return json(file);
  } catch (err) {
    if (err instanceof PathSafetyError) return errorResponse(new HttpError(400, err.message));
    return errorResponse(err);
  }
}

const putSchema = z.object({
  path: z.string().min(1, "path is required"),
  content: z.string(),
  language: z.string().max(40).optional(),
});

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    await ownedProject(id, workspaceId);
    const body = await parseBody(req, putSchema);
    const file = await upsertFile(id, body.path, body.content, { language: body.language });
    return json(file);
  } catch (err) {
    if (err instanceof PathSafetyError) return errorResponse(new HttpError(400, err.message));
    return errorResponse(err);
  }
}
