import { z } from "zod";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { postUserMessage } from "@/server/chat/service";
import {
  HttpError,
  errorResponse,
  json,
  parseBody,
  workspaceIdOf,
} from "@/app/api/_utils";

export const runtime = "nodejs";

const bodySchema = z.object({
  content: z.string().min(1, "Message content is required"),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    const conversation = await db.conversation.findUnique({ where: { id } });
    if (!conversation || conversation.workspaceId !== workspaceId) {
      throw new HttpError(404, "Conversation not found");
    }
    const body = await parseBody(req, bodySchema);
    const message = await postUserMessage(id, body.content);
    return json(message, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
