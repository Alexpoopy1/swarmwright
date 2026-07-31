import { planContentSchema, type PlanContent } from "@/types";
import { getAdapter, connectionConfig } from "@/server/providers/registry";
import { routeModel } from "@/server/router/modelRouter";
import { recordUsage } from "@/server/usage/meter";
import { plannerSystemPrompt } from "./prompts";
import { OrchestratorError } from "./errors";

/**
 * Planner (SPEC §4.6): goal → schema-valid PlanContent via the routed model.
 * Every model response is zod-validated; on parse/validation failure exactly
 * one repair call is made ("Return valid JSON only: <errors>"); if the repair
 * is still invalid we throw OrchestratorError("plan_invalid").
 */

/**
 * Extract the first JSON object from raw model output, tolerating ```json
 * fences and leading/trailing prose. Returns null when no balanced object
 * is found.
 */
export function extractJson(raw: string): unknown | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  const start = text.indexOf("{");
  if (start === -1) return null;
  // Scan for the balanced closing brace (string-aware).
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function formatIssues(err: unknown): string {
  if (err && typeof err === "object" && "issues" in err) {
    const issues = (err as { issues: Array<{ path: PropertyKey[]; message: string }> }).issues;
    return issues
      .slice(0, 8)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
  }
  return String(err);
}

async function completeOnce(args: {
  workspaceId: string;
  projectId?: string;
  runId?: string;
  provider: string;
  model: string;
  connectionId: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
}): Promise<{ content: string; tokensIn: number; tokensOut: number }> {
  const adapter = getAdapter(args.provider);
  const config = await connectionConfig(args.connectionId);
  const result = await adapter.complete(config, {
    model: args.model,
    messages: args.messages,
    temperature: 0.2,
    jsonMode: true,
  });
  await recordUsage({
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    runId: args.runId,
    provider: args.provider,
    model: args.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    kind: "planning",
  });
  return result;
}

export async function generatePlan(
  workspaceId: string,
  goal: string,
  opts?: { instructionOverride?: string; projectId?: string; runId?: string },
): Promise<PlanContent> {
  const decision = await routeModel(workspaceId, {
    taskType: "planning",
    qualityWeight: 1,
    minContext: 4096,
  });
  if (!decision) {
    throw new OrchestratorError(
      "no_provider",
      "No provider connection available for planning. Connect a provider (the mock provider works offline).",
    );
  }

  const base = {
    workspaceId,
    projectId: opts?.projectId,
    runId: opts?.runId,
    provider: decision.provider,
    model: decision.model,
    connectionId: decision.connectionId,
  };
  const system = plannerSystemPrompt();
  // Goal first: providers (and the offline mock) build their answer from the
  // opening of the user turn, so the goal must lead.
  const userPrompt =
    `${goal}\n\n` +
    (opts?.instructionOverride
      ? `Additional instructions (must be reflected in the plan):\n${opts.instructionOverride}\n\n`
      : "") +
    `Produce the execution plan as one JSON object.`;

  const first = await completeOnce({
    ...base,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ],
  });

  const parsedFirst = planContentSchema.safeParse(extractJson(first.content));
  if (parsedFirst.success) return parsedFirst.data;

  // Exactly one repair retry: show the model its own broken output plus the
  // validation errors and demand valid JSON only.
  const firstErrors =
    extractJson(first.content) === null
      ? "output was not a JSON object"
      : formatIssues(parsedFirst.error);
  const repaired = await completeOnce({
    ...base,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content:
          `Your previous reply was invalid. Errors: ${firstErrors}\n\n` +
          `Previous reply:\n${first.content.slice(0, 4000)}\n\n` +
          `Return valid JSON only: a single JSON object matching the schema, no fences, no commentary.`,
      },
    ],
  });

  const parsedSecond = planContentSchema.safeParse(extractJson(repaired.content));
  if (parsedSecond.success) return parsedSecond.data;

  throw new OrchestratorError("plan_invalid", "Planner produced invalid JSON after one repair retry.", {
    firstErrors,
    secondErrors:
      extractJson(repaired.content) === null
        ? "output was not a JSON object"
        : formatIssues(parsedSecond.error),
  });
}
