import { db } from "@/server/db";
import { agentActionSchema, type AgentStepResult, type ChatMessage, type PlanContent, type TaskProfile } from "@/types";
import { fromJson } from "@/server/json";
import { getAdapter, connectionConfig } from "@/server/providers/registry";
import { recordUsage } from "@/server/usage/meter";
import { retrieveMemory } from "@/server/memory";
import { inboxFor } from "./messages";
import { agentSystemPrompt } from "./prompts";
import { extractJson } from "./planner";
import { OrchestratorError } from "./errors";

/**
 * Per-agent runtime (SPEC §4.6) — kept separate from the engine loop for
 * testability. Builds bounded context and executes a single validated
 * model step.
 */

/** Hard cap for the assembled context string (SPEC: never the whole project). */
export const CONTEXT_CAP_CHARS = 3000;

export interface AgentContext {
  workspaceId: string;
  projectId: string;
  runId: string;
  agent: {
    id: string;
    name: string;
    role: string;
    provider: string;
    model: string;
    connectionId: string;
    genomeId: string | null;
  };
  task: {
    id: string;
    title: string;
    description: string;
    taskType: TaskProfile["taskType"];
  };
  /** Assembled by buildAgentContext. */
  context: string;
  /**
   * Prior turns of this task's conversation (assistant action JSONs, newest
   * last). Multi-step providers — including the deterministic mock, whose
   * action rotation is driven by conversation position — need this to make
   * progress across steps.
   */
  history?: ChatMessage[];
  signal?: AbortSignal;
}

function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 20)}\n… [truncated]`;
}

/**
 * Assemble the agent's context: relevant run/agent memory + project memory +
 * the task + recent inbox mail + a plan excerpt. Bounded to ~3000 chars;
 * never dumps whole files or the whole project.
 */
export async function buildAgentContext(args: {
  workspaceId: string;
  projectId: string;
  runId: string;
  agentId: string;
  task: { id: string; title: string; description: string; taskType: string };
}): Promise<string> {
  const query = `${args.task.title} ${args.task.description} ${args.task.taskType}`;

  const [runMemory, projectMemory, inbox, plan] = await Promise.all([
    retrieveMemory({
      workspaceId: args.workspaceId,
      scopes: ["run", "agent"],
      runId: args.runId,
      query,
      limit: 5,
    }).catch(() => []),
    retrieveMemory({
      workspaceId: args.workspaceId,
      scopes: ["project", "longterm"],
      projectId: args.projectId,
      query,
      limit: 3,
    }).catch(() => []),
    inboxFor(args.agentId, { limit: 5 }).catch(() => []),
    db.plan.findFirst({ where: { runId: args.runId }, orderBy: { createdAt: "desc" } }),
  ]);

  const sections: string[] = [];

  // Plan excerpt: summary + this task + its dependencies — never the full doc.
  if (plan) {
    const content = fromJson<PlanContent | null>(plan.contentJson, null);
    if (content) {
      const me = content.tasks.find((t) => t.id === args.task.id);
      const deps = (me?.dependsOn ?? [])
        .map((id) => content.tasks.find((t) => t.id === id))
        .filter((t) => t != null)
        .map((t) => `- ${t.title} (${t.id})`)
        .join("\n");
      sections.push(
        clamp(
          `PLAN EXCERPT\nGoal summary: ${content.summary}\nYour task: ${me?.title ?? args.task.title}` +
            (deps ? `\nDepends on:\n${deps}` : ""),
          700,
        ),
      );
    }
  }

  if (runMemory.length > 0) {
    sections.push(
      clamp(
        `RELEVANT RUN MEMORY\n${runMemory.map((m) => `- ${m.key}: ${m.content}`).join("\n")}`,
        800,
      ),
    );
  }
  if (projectMemory.length > 0) {
    sections.push(
      clamp(
        `PROJECT KNOWLEDGE\n${projectMemory.map((m) => `- ${m.key}: ${m.content}`).join("\n")}`,
        500,
      ),
    );
  }
  if (inbox.length > 0) {
    sections.push(
      clamp(
        `RECENT MESSAGES\n${inbox
          .map((m) => `- from ${m.fromName}: ${m.summary}${m.requestedAction ? ` (asks: ${m.requestedAction})` : ""}`)
          .join("\n")}`,
        600,
      ),
    );
  }

  return clamp(sections.join("\n\n") || "(no prior context)", CONTEXT_CAP_CHARS);
}

/**
 * Run ONE agent step: model call with the agent system prompt (jsonMode),
 * zod-validate the action (one repair retry), meter usage, update the Agent
 * row aggregates, and return the typed result.
 */
export async function runAgentStep(ctx: AgentContext): Promise<AgentStepResult> {
  const adapter = getAdapter(ctx.agent.provider);
  const config = await connectionConfig(ctx.agent.connectionId);
  const system = agentSystemPrompt(ctx.agent.role, ctx.task, ctx.context);
  // Task first: providers key content (and the mock keys file slugs) off the
  // opening of the user turn.
  const history = (ctx.history ?? []).slice(-8); // bounded context, always
  const userPrompt =
    `${ctx.task.title}\n${ctx.task.description}\n\n` +
    (history.length > 0 ? `Previous actions are above. Emit the NEXT single action.\n\n` : "") +
    `Reply with exactly one JSON action object.`;

  let tokensIn = 0;
  let tokensOut = 0;
  const started = Date.now();

  const call = (repairNote?: string) =>
    adapter.complete(config, {
      model: ctx.agent.model,
      messages: [
        { role: "system", content: system },
        ...history,
        {
          role: "user",
          content: repairNote
            ? `${repairNote}\n\n${userPrompt}`
            : userPrompt,
        },
      ],
      temperature: 0.3,
      jsonMode: true,
      signal: ctx.signal,
    });

  const first = await call();
  tokensIn += first.tokensIn;
  tokensOut += first.tokensOut;

  let parsed = agentActionSchema.safeParse(extractJson(first.content));
  if (!parsed.success) {
    // Exactly one repair retry with the validation errors echoed back.
    const note =
      `Your previous reply was not a valid action. Return valid JSON only: ` +
      `exactly one action object matching the ACTION SCHEMA. ` +
      `(Errors: ${parsed.error.issues
        .slice(0, 5)
        .map((i) => i.message)
        .join("; ")})`;
    const second = await call(note);
    tokensIn += second.tokensIn;
    tokensOut += second.tokensOut;
    parsed = agentActionSchema.safeParse(extractJson(second.content));
    if (!parsed.success) {
      throw new OrchestratorError(
        "agent_action_invalid",
        `Agent ${ctx.agent.name} produced an invalid action after one repair retry.`,
        parsed.error.issues.slice(0, 5),
      );
    }
  }

  const latencyMs = Date.now() - started;

  const { costUsd } = await recordUsage({
    workspaceId: ctx.workspaceId,
    projectId: ctx.projectId,
    runId: ctx.runId,
    agentId: ctx.agent.id,
    provider: ctx.agent.provider,
    model: ctx.agent.model,
    tokensIn,
    tokensOut,
    kind: "agent",
  });

  await db.agent.update({
    where: { id: ctx.agent.id },
    data: {
      tokensIn: { increment: tokensIn },
      tokensOut: { increment: tokensOut },
      costUsd: { increment: costUsd },
    },
  });

  return { action: parsed.data, tokensIn, tokensOut, latencyMs };
}
