import { z } from "zod";
import { requireUser } from "@/server/auth";
import { createConversation, listConversations } from "@/server/chat/service";
import { errorResponse, json, parseBody, workspaceIdOf } from "@/app/api/_utils";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const url = new URL(req.url);
    const query = url.searchParams.get("query") ?? undefined;
    const conversations = await listConversations(workspaceId, { query });
    return json({ conversations });
  } catch (err) {
    return errorResponse(err);
  }
}

const createSchema = z.object({
  title: z.string().max(200).optional(),
  projectId: z.string().optional(),
  mode: z.enum(["chat", "council"]).optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const body = await parseBody(req, createSchema);
    const conversation = await createConversation(workspaceId, body);
    return json(conversation, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
