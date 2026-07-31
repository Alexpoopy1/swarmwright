import { z } from "zod";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import {
  councilReply,
  postUserMessage,
  streamAssistantReply,
} from "@/server/chat/service";
import {
  HttpError,
  errorResponse,
  parseBody,
  sseFrame,
  sseResponse,
  workspaceIdOf,
} from "@/app/api/_utils";

export const runtime = "nodejs";

/**
 * SSE chat stream (SPEC §5). Two flows:
 *  - body carries `content` → the user message is posted first, then the
 *    assistant reply is streamed as `{delta}` frames + final `{done, messageId}`.
 *  - no `content` → only the assistant reply is streamed (regenerate flow).
 * `mode: "council"` runs the council concurrently and emits a single
 * `{done, messageId}` frame (the synthesis is persisted, nothing streams).
 */
const bodySchema = z.object({
  conversationId: z.string().min(1, "conversationId is required"),
  content: z.string().optional(),
  connectionId: z.string().optional(),
  model: z.string().optional(),
  parentMessageId: z.string().optional(),
  mode: z.enum(["chat", "council"]).optional(),
  connectionIds: z.array(z.string()).optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const body = await parseBody(req, bodySchema);

    const conversation = await db.conversation.findUnique({
      where: { id: body.conversationId },
    });
    if (!conversation || conversation.workspaceId !== workspaceId) {
      throw new HttpError(404, "Conversation not found");
    }

    // Post the user's message first when content is included.
    if (body.content && body.content.trim().length > 0) {
      await postUserMessage(body.conversationId, body.content);
    }

    if (body.mode === "council") {
      const connectionIds = body.connectionIds ?? [];
      if (connectionIds.length === 0) {
        throw new HttpError(400, "council mode requires connectionIds");
      }
      // Council reply is computed up-front; failures here are normal errors.
      const { messageId } = await councilReply({
        conversationId: body.conversationId,
        connectionIds,
      });
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(sseFrame({ done: true, messageId })));
          controller.close();
        },
      });
      return sseResponse(stream);
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const send = (data: unknown) => {
          if (closed || req.signal.aborted) return;
          try {
            controller.enqueue(encoder.encode(sseFrame(data)));
          } catch {
            closed = true;
          }
        };
        const finish = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        };

        const gen = streamAssistantReply({
          conversationId: body.conversationId,
          connectionId: body.connectionId,
          model: body.model,
          parentMessageId: body.parentMessageId,
        });
        // Client disconnect → stop the generator (it still persists partials).
        const onAbort = () => {
          void gen.return(undefined);
        };
        req.signal.addEventListener("abort", onAbort, { once: true });

        try {
          for await (const chunk of gen) {
            if (chunk.delta) send({ delta: chunk.delta });
          }
          if (!req.signal.aborted) {
            // The service persists the assistant message internally; recover
            // its id so the client can attach provider/model metadata.
            const last = await db.message.findFirst({
              where: { conversationId: body.conversationId, role: "assistant" },
              orderBy: { createdAt: "desc" },
              select: { id: true },
            });
            send({ done: true, messageId: last?.id ?? null });
          }
        } catch (err) {
          if (!req.signal.aborted) {
            console.error("[api] chat stream failed:", err);
            send({ error: err instanceof Error ? err.message : "Chat stream failed" });
          }
        } finally {
          req.signal.removeEventListener("abort", onAbort);
          finish();
        }
      },
    });
    return sseResponse(stream);
  } catch (err) {
    return errorResponse(err);
  }
}
