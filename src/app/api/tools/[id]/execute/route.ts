import { z } from "zod";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { executeTool } from "@/server/tools/factory";
import {
  HttpError,
  errorResponse,
  json,
  parseBody,
  workspaceIdOf,
} from "@/app/api/_utils";

export const runtime = "nodejs";

const bodySchema = z.object({
  input: z.record(z.unknown()).default({}),
  autonomy: z.enum(["observe", "ask_all", "ask_risky", "auto"]).default("ask_risky"),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    const tool = await db.toolDefinition.findUnique({
      where: { id },
      select: { id: true, project: { select: { workspaceId: true } } },
    });
    if (!tool || tool.project.workspaceId !== workspaceId) {
      throw new HttpError(404, "Tool not found");
    }
    const body = await parseBody(req, bodySchema);
    const result = await executeTool({
      toolId: id,
      input: body.input,
      autonomy: body.autonomy,
    });
    return json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
