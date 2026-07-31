import { z } from "zod";
import { requireUser } from "@/server/auth";
import { createProject, listProjects } from "@/server/projects";
import { errorResponse, json, parseBody, workspaceIdOf } from "@/app/api/_utils";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const projects = await listProjects(workspaceId);
    return json({ projects });
  } catch (err) {
    return errorResponse(err);
  }
}

const createSchema = z.object({
  name: z.string().min(1, "Project name is required").max(120),
  description: z.string().max(2000).optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const body = await parseBody(req, createSchema);
    const project = await createProject(workspaceId, body);
    return json(project, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
