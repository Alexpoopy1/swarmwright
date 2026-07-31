/**
 * Client SSE utilities (SPEC §6.3).
 *
 * Two consumers:
 *  - `connectRunEvents` — GET /api/runs/[id]/events?afterSeq= (replay + live bus),
 *    fetch-based reader with auto-reconnect/backoff and an afterSeq cursor.
 *  - `streamChat` — POST /api/chat/stream, same SSE frame parsing on a POST body.
 *
 * We use fetch + ReadableStream instead of EventSource because EventSource
 * cannot POST and gives no control over retry cursors.
 */
import type { SwarmEvent } from "@/types";

/** Parse an SSE byte buffer, returning complete `data:` payloads + remainder. */
function drainFrames(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = [];
  let rest = buffer;
  // Frames are separated by a blank line (\n\n or \r\n\r\n).
  for (;;) {
    const m = /\r?\n\r?\n/.exec(rest);
    if (!m) break;
    const raw = rest.slice(0, m.index);
    rest = rest.slice(m.index + m[0].length);
    const dataLines = raw
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""));
    if (dataLines.length > 0) frames.push(dataLines.join("\n"));
  }
  return { frames, rest };
}

/** Read an SSE response body to completion, invoking onData per JSON frame. */
async function readSseStream(
  res: Response,
  onData: (json: unknown) => void,
  signal: AbortSignal
): Promise<void> {
  if (!res.body) throw new Error("SSE response has no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      if (signal.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = drainFrames(buffer);
      buffer = rest;
      for (const frame of frames) {
        if (frame === "[DONE]") continue;
        try {
          onData(JSON.parse(frame));
        } catch {
          // Ignore malformed frames (keepalives, comments).
        }
      }
    }
    // Flush any trailing frame without a blank-line terminator.
    buffer += decoder.decode();
    const { frames } = drainFrames(buffer + "\n\n");
    for (const frame of frames) {
      try {
        onData(JSON.parse(frame));
      } catch {
        /* ignore */
      }
    }
  } finally {
    try {
      reader.cancel();
    } catch {
      /* ignore */
    }
  }
}

export interface ConnectRunEventsOptions {
  /** Resume cursor — only events with seq > afterSeq are replayed. */
  afterSeq?: number;
  onEvent: (event: SwarmEvent) => void;
  /** Called for transient errors and (finally) when reconnects are exhausted. */
  onError?: (error: Error, info: { attempt: number; final: boolean }) => void;
  /** Max reconnect attempts before giving up (default 5). */
  maxRetries?: number;
}

export interface RunEventsConnection {
  /** Stop the stream and cancel any pending reconnect. */
  close: () => void;
  /** Latest sequence number seen (usable as an afterSeq cursor). */
  lastSeq: () => number;
}

const RETRY_BASE_MS = 600;

/**
 * Connect to a run's live event stream. Replays events after `afterSeq`,
 * then follows the live bus. On network failure the stream reconnects with
 * exponential backoff (max `maxRetries`, default 5) resuming from the last
 * seen sequence number.
 */
export function connectRunEvents(
  runId: string,
  opts: ConnectRunEventsOptions
): RunEventsConnection {
  const maxRetries = opts.maxRetries ?? 5;
  let closed = false;
  let attempt = 0;
  let seq = opts.afterSeq ?? 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;

  const connect = async () => {
    if (closed) return;
    controller = new AbortController();
    try {
      const res = await fetch(
        `/api/runs/${encodeURIComponent(runId)}/events?afterSeq=${seq}`,
        {
          headers: { Accept: "text/event-stream" },
          signal: controller.signal,
          cache: "no-store",
        }
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`events stream failed (${res.status}): ${text.slice(0, 200)}`);
      }
      // Connected — reset backoff and consume frames until the socket ends.
      attempt = 0;
      await readSseStream(
        res,
        (json) => {
          const e = json as SwarmEvent;
          if (typeof e?.seq === "number") seq = Math.max(seq, e.seq);
          if (!closed) opts.onEvent(e);
        },
        controller.signal
      );
      if (closed) return;
      // Server closed the stream cleanly (e.g. run finished / deploy reload).
      throw new Error("events stream ended");
    } catch (err) {
      if (closed || controller?.signal.aborted) return;
      const error = err instanceof Error ? err : new Error(String(err));
      if (attempt >= maxRetries) {
        opts.onError?.(error, { attempt, final: true });
        return;
      }
      opts.onError?.(error, { attempt, final: false });
      const delay = RETRY_BASE_MS * 2 ** attempt + Math.floor(Math.random() * 150);
      attempt += 1;
      retryTimer = setTimeout(connect, delay);
    }
  };

  void connect();

  return {
    close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      controller?.abort();
    },
    lastSeq: () => seq,
  };
}

export interface StreamChatBody {
  conversationId: string;
  connectionId?: string;
  model?: string;
  parentMessageId?: string;
  mode?: "chat" | "council";
  connectionIds?: string[];
}

export interface StreamChatOptions {
  /** Incremental assistant text. */
  onDelta: (delta: string) => void;
  /** Final frame — server persists the message and reports its id + usage. */
  onDone?: (info: {
    messageId?: string;
    provider?: string;
    model?: string;
    usage?: { tokensIn: number; tokensOut: number };
    costUsd?: number;
  }) => void;
  onError?: (error: Error) => void;
  /** Abort with an AbortController to implement "Stop generation". */
  signal?: AbortSignal;
}

/**
 * POST /api/chat/stream — streams `{delta}` frames then a final
 * `{done, messageId, ...}` frame. Returns a close() handle.
 */
export function streamChat(
  body: StreamChatBody,
  opts: StreamChatOptions
): { close: () => void; done: Promise<void> } {
  const inner = new AbortController();
  const outer = opts.signal;
  const onOuterAbort = () => inner.abort();
  if (outer) {
    if (outer.aborted) inner.abort();
    else outer.addEventListener("abort", onOuterAbort, { once: true });
  }

  const done = (async () => {
    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal: inner.signal,
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`chat stream failed (${res.status}): ${text.slice(0, 300)}`);
      }
      await readSseStream(
        res,
        (json) => {
          const frame = json as {
            delta?: string;
            done?: boolean;
            messageId?: string;
            provider?: string;
            model?: string;
            usage?: { tokensIn: number; tokensOut: number };
            costUsd?: number;
            error?: string;
          };
          if (typeof frame?.delta === "string") opts.onDelta(frame.delta);
          if (frame?.error) opts.onError?.(new Error(frame.error));
          if (frame?.done) {
            opts.onDone?.({
              messageId: frame.messageId,
              provider: frame.provider,
              model: frame.model,
              usage: frame.usage,
              costUsd: frame.costUsd,
            });
          }
        },
        inner.signal
      );
    } catch (err) {
      if (inner.signal.aborted) return; // user pressed Stop — not an error
      opts.onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      outer?.removeEventListener("abort", onOuterAbort);
    }
  })();

  return { close: () => inner.abort(), done };
}
