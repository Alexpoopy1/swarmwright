import type { SwarmEvent } from "@/types";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { subscribe } from "@/server/events/bus";
import { listEvents } from "@/server/events/store";
import {
  HttpError,
  errorResponse,
  queryInt,
  sseFrame,
  sseResponse,
  workspaceIdOf,
} from "@/app/api/_utils";

export const runtime = "nodejs";

/**
 * Run event stream (SPEC §5): replay persisted events after `?afterSeq`,
 * then fan in live bus events. `: ping` heartbeat every 15s keeps proxies
 * from buffering/closing the connection. Everything cleans up on abort.
 *
 * The bus subscription is installed BEFORE the DB replay and buffers live
 * events, so events emitted during the replay are never missed (deduped by
 * sequence number).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const workspaceId = await workspaceIdOf(user.id);
    const { id: runId } = await ctx.params;
    const run = await db.agentRun.findFirst({
      where: { id: runId, project: { workspaceId } },
      select: { id: true },
    });
    if (!run) throw new HttpError(404, "Run not found");

    const afterSeq = queryInt(new URL(req.url), "afterSeq") ?? 0;
    const encoder = new TextEncoder();

    let cleanup: () => void = () => {};

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        let live = false;
        let lastSeq = afterSeq;
        const buffered: SwarmEvent[] = [];

        const sendEvent = (e: SwarmEvent) => {
          if (closed || e.seq <= lastSeq) return;
          lastSeq = e.seq;
          try {
            controller.enqueue(encoder.encode(sseFrame(e)));
          } catch {
            closed = true;
          }
        };

        // Subscribe first, buffer until the replay catches up.
        const unsubscribe = subscribe(runId, (e) => {
          if (!live) buffered.push(e);
          else sendEvent(e);
        });

        const heartbeat = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            closed = true;
          }
        }, 15_000);

        cleanup = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          unsubscribe();
          try {
            controller.close();
          } catch {
            // already closed
          }
        };
        req.signal.addEventListener("abort", cleanup, { once: true });

        void (async () => {
          try {
            const replay = await listEvents({ runId, afterSeq, limit: 10_000 });
            for (const e of replay) sendEvent(e);
            live = true;
            for (const e of buffered.splice(0)) sendEvent(e);
          } catch (err) {
            console.error("[api] run events replay failed:", err);
            cleanup();
          }
        })();
      },
      cancel() {
        cleanup();
      },
    });

    return sseResponse(stream);
  } catch (err) {
    return errorResponse(err);
  }
}
