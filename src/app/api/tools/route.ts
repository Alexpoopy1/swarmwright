import { z } from "zod";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { listTools, proposeTool } from "@/server/tools/factory";
import {
  HttpError,
  errorResponse,
  json,
  parseBody,
  workspaceIdOf,
} from "@/app/api/_utils";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const projectId = new URL(req.url).searchParams.get("projectId") ?? undefined;
    if (projectId) {
      const project = await db.project.findUnique({
        where: { id: projectId },
        select: { workspaceId: true },
      });
      if (!project || project.workspaceId !== workspaceId) {
        throw new HttpError(404, "Project not found");
      }
    }
    const tools = await listTools(projectId);
    return json({ tools });
  } catch (err) {
    return errorResponse(err);
  }
}

const createSchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
  name: z.string().min(1, "Tool name is required"),
  description: z.string().default(""),
  type: z
    .enum(["js_function", "http", "shell", "file_transform", "search", "code_analysis", "automation"])
    .optional(),
  toolType: z
    .enum(["js_function", "http", "shell", "file_transform", "search", "code_analysis", "automation"])
    .optional(),
  inputSchema: z.record(z.unknown()).default({}),
  permissions: z.array(z.string()).default([]),
  sourceCode: z.string().min(1, "sourceCode is required"),
  testCode: z.string().default(""),
  reason: z.string().default("manual tool builder"),
  autonomy: z.enum(["observe", "ask_all", "ask_risky", "auto"]).default("ask_risky"),
});

/** Manual tool creation goes through the same factory pipeline
 *  (validate → classify → sandbox tests → approval gate) as agent proposals. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const body = await parseBody(req, createSchema);
    const project = await db.project.findUnique({
      where: { id: body.projectId },
      select: { workspaceId: true },
    });
    if (!project || project.workspaceId !== workspaceId) {
      throw new HttpError(404, "Project not found");
    }
    const toolType = body.type ?? body.toolType;
    if (!toolType) throw new HttpError(400, "type is required");

    const result = await proposeTool({
      projectId: body.projectId,
      autonomy: body.autonomy,
      proposal: {
        type: "tool_propose",
        name: body.name,
        description: body.description,
        toolType,
        inputSchema: body.inputSchema,
        permissions: body.permissions,
        sourceCode: body.sourceCode,
        testCode: body.testCode,
        reason: body.reason,
      },
    });
    return json(result, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
