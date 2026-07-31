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

async function ownedConversation(id: string, workspaceId: string) {
  const row = await db.conversation.findUnique({ where: { id } });
  if (!row || row.workspaceId !== workspaceId) throw new HttpError(404, "Conversation not found");
  return row;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    const conversation = await ownedConversation(id, workspaceId);
    const messages = await db.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: "asc" },
    });
    return json({
      ...conversation,
      messages: messages.map((m) => ({
        ...m,
        metadataJson: fromJson<Record<string, unknown>>(m.metadataJson, {}),
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  archived: z.boolean().optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    await ownedConversation(id, workspaceId);
    const body = await parseBody(req, patchSchema);
    const conversation = await db.conversation.update({
      where: { id },
      data: {
        title: body.title?.trim(),
        archived: body.archived,
      },
    });
    return json(conversation);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id } = await ctx.params;
    await ownedConversation(id, workspaceId);
    await db.conversation.delete({ where: { id } });
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
