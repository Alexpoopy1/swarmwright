import type { Conversation, Message } from "@prisma/client";
import type { ChatChunk, ChatMessage, ProviderConnectionConfig } from "@/types";
import { db } from "@/server/db";
import { toJson } from "@/server/json";
import { connectionConfig, getAdapter, listConnectionModels } from "@/server/providers/registry";
import { estimateCostUsd } from "@/server/providers/pricing";
import { routeModel } from "@/server/router/modelRouter";
import { recordUsage } from "@/server/usage/meter";

/**
 * Conversation service (SPEC §4.10) — chat mode, council mode, branching.
 */

const HISTORY_LIMIT = 30;
const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export async function createConversation(
  workspaceId: string,
  input: { title?: string; projectId?: string; mode?: "chat" | "council" }
): Promise<Conversation> {
  return db.conversation.create({
    data: {
      workspaceId,
      projectId: input.projectId ?? null,
      title: input.title?.trim() || "New conversation",
      mode: input.mode ?? "chat",
    },
  });
}

export async function listConversations(
  workspaceId: string,
  opts?: { query?: string }
): Promise<Conversation[]> {
  const query = opts?.query?.trim();
  return db.conversation.findMany({
    where: {
      workspaceId,
      archived: false,
      ...(query
        ? {
            OR: [
              { title: { contains: query } },
              { messages: { some: { content: { contains: query } } } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function postUserMessage(conversationId: string, content: string): Promise<Message> {
  return db.message.create({
    data: { conversationId, role: "user", content },
  });
}

async function loadHistory(conversationId: string): Promise<ChatMessage[]> {
  const rows = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
  });
  return rows.reverse().map((m) => ({
    role: (["system", "user", "assistant", "tool"].includes(m.role) ? m.role : "user") as ChatMessage["role"],
    content: m.content,
  }));
}

interface ResolvedModel {
  config: ProviderConnectionConfig;
  model: string;
  routedReason: string | null;
}

async function resolveModel(
  workspaceId: string,
  override?: { connectionId?: string; model?: string }
): Promise<ResolvedModel> {
  if (override?.connectionId && override?.model) {
    const config = await connectionConfig(override.connectionId);
    return { config, model: override.model, routedReason: null };
  }
  if (override?.connectionId) {
    const config = await connectionConfig(override.connectionId);
    const models = await listConnectionModels(override.connectionId);
    if (models.length === 0) throw new Error("no models available for this connection");
    return { config, model: models[0].model, routedReason: null };
  }
  const decision = await routeModel(workspaceId, { taskType: "general", qualityWeight: 0.6 });
  if (!decision) throw new Error("no provider connected — add one in Providers settings");
  const config = await connectionConfig(decision.connectionId);
  return { config, model: decision.model, routedReason: decision.reason };
}

export async function* streamAssistantReply(args: {
  conversationId: string;
  connectionId?: string;
  model?: string;
  parentMessageId?: string;
}): AsyncGenerator<ChatChunk> {
  const conversation = await db.conversation.findUnique({
    where: { id: args.conversationId },
  });
  if (!conversation) throw new Error(`conversation not found: ${args.conversationId}`);

  const messages = await loadHistory(args.conversationId);
  const resolved = await resolveModel(conversation.workspaceId, {
    connectionId: args.connectionId,
    model: args.model,
  });
  const adapter = getAdapter(resolved.config.provider);

  let content = "";
  let tokensIn = estimateTokens(messages.map((m) => m.content).join("\n"));
  let tokensOut = 0;
  let persisted = false;

  const persist = async () => {
    if (persisted || content.length === 0) return;
    persisted = true;
    if (tokensOut === 0) tokensOut = estimateTokens(content);
    const costUsd = estimateCostUsd(resolved.config.provider, resolved.model, tokensIn, tokensOut);
    const message = await db.message.create({
      data: {
        conversationId: args.conversationId,
        role: "assistant",
        content,
        provider: resolved.config.provider,
        model: resolved.model,
        tokensIn,
        tokensOut,
        costUsd,
        parentId: args.parentMessageId ?? null,
        metadataJson: toJson({
          routed: resolved.routedReason,
          connectionId: resolved.config.id,
        }),
      },
    });
    await recordUsage({
      workspaceId: conversation.workspaceId,
      projectId: conversation.projectId ?? undefined,
      provider: resolved.config.provider,
      model: resolved.model,
      tokensIn,
      tokensOut,
      kind: "chat",
    });
    return message;
  };

  try {
    for await (const chunk of adapter.stream(resolved.config, { model: resolved.model, messages })) {
      if (chunk.delta) content += chunk.delta;
      if (chunk.usage) {
        tokensIn = chunk.usage.tokensIn;
        tokensOut = chunk.usage.tokensOut;
      }
      yield chunk;
    }
  } finally {
    // Persist even if the client disconnected mid-stream (partial reply kept).
    await persist();
  }
}

export async function councilReply(args: {
  conversationId: string;
  connectionIds: string[];
}): Promise<{ messageId: string }> {
  const conversation = await db.conversation.findUnique({
    where: { id: args.conversationId },
  });
  if (!conversation) throw new Error(`conversation not found: ${args.conversationId}`);

  const messages = await loadHistory(args.conversationId);
  const question = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const ids = args.connectionIds.slice(0, 3);
  if (ids.length === 0) throw new Error("council requires at least one connection");

  // Ask every council member concurrently; failures don't sink the council.
  const answers = await Promise.allSettled(
    ids.map(async (connectionId) => {
      const config = await connectionConfig(connectionId);
      const models = await listConnectionModels(connectionId);
      const model = models[0]?.model;
      if (!model) throw new Error("no models available");
      const result = await getAdapter(config.provider).complete(config, { model, messages });
      await recordUsage({
        workspaceId: conversation.workspaceId,
        projectId: conversation.projectId ?? undefined,
        provider: config.provider,
        model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        kind: "chat",
      });
      return { connectionId, provider: config.provider, model, answer: result.content };
    })
  );

  const council = answers.map((a, i) =>
    a.status === "fulfilled"
      ? a.value
      : { connectionId: ids[i], provider: "", model: "", answer: "", error: a.reason instanceof Error ? a.reason.message : String(a.reason) }
  );
  const successful = council.filter((c) => !("error" in c) && c.answer.length > 0);
  if (successful.length === 0) {
    throw new Error("all council members failed to answer");
  }

  // Synthesize with the best available model (quality-first routing).
  let synthConfig: ProviderConnectionConfig;
  let synthModel: string;
  const decision = await routeModel(conversation.workspaceId, {
    taskType: "review",
    qualityWeight: 1,
  });
  if (decision) {
    synthConfig = await connectionConfig(decision.connectionId);
    synthModel = decision.model;
  } else {
    synthConfig = await connectionConfig(successful[0].connectionId);
    synthModel = successful[0].model;
  }

  const synthesisPrompt: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are the synthesis voice of a model council. Given the user's message and several candidate answers, produce the single strongest answer: accurate, complete, and well-structured. Do not mention the council itself unless useful.",
    },
    {
      role: "user",
      content: [
        `User message:\n${question}`,
        "",
        "Candidate answers:",
        ...successful.map(
          (c, i) => `--- Answer ${i + 1} (${c.provider}/${c.model}) ---\n${c.answer}`
        ),
      ].join("\n"),
    },
  ];

  const synth = await getAdapter(synthConfig.provider).complete(synthConfig, {
    model: synthModel,
    messages: synthesisPrompt,
  });
  const synthCost = estimateCostUsd(
    synthConfig.provider,
    synthModel,
    synth.tokensIn,
    synth.tokensOut
  );
  await recordUsage({
    workspaceId: conversation.workspaceId,
    projectId: conversation.projectId ?? undefined,
    provider: synthConfig.provider,
    model: synthModel,
    tokensIn: synth.tokensIn,
    tokensOut: synth.tokensOut,
    kind: "chat",
  });

  const message = await db.message.create({
    data: {
      conversationId: args.conversationId,
      role: "assistant",
      content: synth.content,
      provider: synthConfig.provider,
      model: synthModel,
      tokensIn: synth.tokensIn,
      tokensOut: synth.tokensOut,
      costUsd: synthCost,
      metadataJson: toJson({ council }),
    },
  });
  return { messageId: message.id };
}

export async function branchConversation(
  conversationId: string,
  fromMessageId: string
): Promise<{ conversationId: string }> {
  const source = await db.conversation.findUnique({ where: { id: conversationId } });
  if (!source) throw new Error(`conversation not found: ${conversationId}`);
  const pivot = await db.message.findUnique({ where: { id: fromMessageId } });
  if (!pivot || pivot.conversationId !== conversationId) {
    throw new Error("fromMessageId does not belong to this conversation");
  }

  const messages = await db.message.findMany({
    where: { conversationId, createdAt: { lte: pivot.createdAt } },
    orderBy: { createdAt: "asc" },
  });

  const branch = await db.conversation.create({
    data: {
      workspaceId: source.workspaceId,
      projectId: source.projectId,
      title: `${source.title} (branch)`,
      mode: source.mode,
    },
  });

  // Copy messages, remapping parent links into the branch.
  const idMap = new Map<string, string>();
  for (const m of messages) {
    const copy = await db.message.create({
      data: {
        conversationId: branch.id,
        role: m.role,
        content: m.content,
        provider: m.provider,
        model: m.model,
        tokensIn: m.tokensIn,
        tokensOut: m.tokensOut,
        costUsd: m.costUsd,
        parentId: m.parentId ? idMap.get(m.parentId) ?? null : null,
        metadataJson: m.metadataJson,
      },
    });
    idMap.set(m.id, copy.id);
  }

  return { conversationId: branch.id };
}
