import { db } from "@/server/db";
import { emitEvent } from "@/server/events/store";
import type { MemoryScope } from "@/types";

/**
 * Scoped memory service (SPEC §4.7).
 *
 * Memory is durable (DB) and scoped: conversation | agent | run | project |
 * longterm | tool_perf. Retrieval uses keyword term-overlap scoring with a
 * recency tiebreak; expired items are always excluded.
 */

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is",
  "are", "was", "were", "be", "by", "at", "as", "it", "this", "that", "from",
]);

function tokenize(text: string): Set<string> {
  const terms = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9_]+/)) {
    if (raw.length < 2 || STOP_WORDS.has(raw)) continue;
    terms.add(raw);
  }
  return terms;
}

export async function saveMemory(m: {
  workspaceId: string;
  projectId?: string;
  runId?: string;
  agentId?: string;
  scope: MemoryScope;
  key: string;
  content: string;
  expiresAt?: Date;
}): Promise<void> {
  await db.memoryItem.create({
    data: {
      workspaceId: m.workspaceId,
      projectId: m.projectId ?? null,
      runId: m.runId ?? null,
      agentId: m.agentId ?? null,
      scope: m.scope,
      key: m.key,
      content: m.content,
      expiresAt: m.expiresAt ?? null,
    },
  });
  if (m.runId) {
    await emitEvent({
      runId: m.runId,
      projectId: m.projectId ?? null,
      type: "MEMORY_SAVED",
      actorType: "system",
      summary: `Memory saved (${m.scope}: ${m.key})`,
      payload: { scope: m.scope, key: m.key },
    });
  }
}

/**
 * Retrieve memories by scope with keyword relevance.
 *
 * Dimension filters (projectId/runId/agentId) use "match-or-null" semantics:
 * an item whose dimension is NULL is global on that axis and matches any
 * filter value. This lets a run query also see project-level knowledge
 * without leaking other runs' data.
 */
export async function retrieveMemory(q: {
  workspaceId: string;
  scopes: MemoryScope[];
  projectId?: string;
  runId?: string;
  agentId?: string;
  query?: string;
  limit?: number;
}): Promise<Array<{ key: string; content: string; scope: string }>> {
  const limit = q.limit ?? 10;
  const now = new Date();
  const rows = await db.memoryItem.findMany({
    where: {
      workspaceId: q.workspaceId,
      scope: { in: q.scopes },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      AND: [
        { OR: [{ projectId: null }, ...(q.projectId ? [{ projectId: q.projectId }] : [])] },
        { OR: [{ runId: null }, ...(q.runId ? [{ runId: q.runId }] : [])] },
        { OR: [{ agentId: null }, ...(q.agentId ? [{ agentId: q.agentId }] : [])] },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 200, // score in-process; bounded scan keeps this cheap
  });

  const queryTerms = q.query ? tokenize(q.query) : new Set<string>();
  const scored = rows.map((row, index) => {
    let score = 0;
    if (queryTerms.size > 0) {
      const hay = tokenize(`${row.key} ${row.content}`);
      for (const term of queryTerms) if (hay.has(term)) score += 1;
    }
    // index preserves recency order (rows sorted desc) → tiebreak.
    return { row, score, index };
  });

  if (queryTerms.size > 0) {
    scored.sort((a, b) => b.score - a.score || a.index - b.index);
  }

  return scored.slice(0, limit).map(({ row }) => ({
    key: row.key,
    content: row.content,
    scope: row.scope,
  }));
}

/**
 * Compress a scope's memories into a short digest. Uses the routed model
 * when available; falls back to deterministic truncation so memory never
 * blocks a run (SPEC §4.7).
 */
export async function summarizeScope(args: {
  workspaceId: string;
  scope: MemoryScope;
  projectId?: string;
  runId?: string;
  agentId?: string;
  maxChars?: number;
}): Promise<string> {
  const maxChars = args.maxChars ?? 2000;
  const items = await retrieveMemory({
    workspaceId: args.workspaceId,
    scopes: [args.scope],
    projectId: args.projectId,
    runId: args.runId,
    agentId: args.agentId,
    limit: 100,
  });
  const joined = items.map((i) => `${i.key}: ${i.content}`).join("\n---\n");
  if (joined.length <= maxChars) return joined;

  try {
    // Lazy imports: memory is used by the router's neighbors; deferring avoids
    // a module cycle and keeps the fallback path dependency-free.
    const { routeModel } = await import("@/server/router/modelRouter");
    const { getAdapter, connectionConfig } = await import("@/server/providers/registry");
    const decision = await routeModel(args.workspaceId, {
      taskType: "general",
      qualityWeight: 0.3,
    });
    if (!decision) throw new Error("no provider");
    const adapter = getAdapter(decision.provider);
    const config = await connectionConfig(decision.connectionId);
    const result = await adapter.complete(config, {
      model: decision.model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You compress workspace memory notes into a dense factual digest. " +
            `Reply with at most ${maxChars} characters. No commentary, no chain-of-thought.`,
        },
        { role: "user", content: joined.slice(0, 12000) },
      ],
    });
    const summary = result.content.trim();
    if (summary.length > 0) return summary.slice(0, maxChars);
    throw new Error("empty summary");
  } catch {
    // Fallback: keep the most recent head and the oldest tail for context.
    const head = joined.slice(0, Math.floor(maxChars * 0.7));
    const tail = joined.slice(-Math.floor(maxChars * 0.25));
    return `${head}\n… [truncated ${joined.length - head.length - tail.length} chars] …\n${tail}`;
  }
}

export async function deleteMemory(id: string): Promise<void> {
  await db.memoryItem.delete({ where: { id } });
}
