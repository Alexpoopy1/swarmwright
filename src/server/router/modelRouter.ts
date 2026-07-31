import type { ModelInfo, RouteDecision, TaskProfile } from "@/types";
import { db } from "@/server/db";
import { fromJson } from "@/server/json";
import { connectionConfig, getAdapter } from "@/server/providers/registry";
import { FALLBACK_MODELS } from "@/server/providers/pricing";

/**
 * Model router (SPEC §4.4) — deterministic scoring over every connected
 * provider's models.
 *
 * score = qualityBase(taskType↔model heuristics) · qualityWeight
 *       − costPenalty − latencyPenalty
 *       + availabilityBonus + genomeBonus
 *
 * `scoreModel` is a pure, exported, unit-testable function; `routeModel`
 * gathers candidates (adapter.listModels with FALLBACK_MODELS fallback),
 * applies hard filters and returns the best-scoring decision.
 */

export interface ScoreContext {
  /** ProviderConnection.status — "ok" earns an availability bonus. */
  connectionStatus?: string;
  /** AgentGenome.successRate for a matching role/taskType, when known. */
  genomeSuccessRate?: number | null;
}

/** Heuristic "how good is this model" in [0,1], based on well-known ids. */
function qualityBase(model: ModelInfo): number {
  const id = model.model.toLowerCase();
  if (id.startsWith("mock-")) return 0.5;
  if (/(^|[-/])gpt-4o(?!-mini)/.test(id) || /claude-3[-.]5|opus/.test(id)) return 0.95;
  if (/70b|deepseek-chat|gpt-4-turbo|qwen2\.5-72b/.test(id)) return 0.85;
  if (/mini|8b|haiku|flash|7b/.test(id)) return 0.65;
  return 0.6;
}

/** Task-type affinity: big models for planning/review, fast ones for docs. */
function taskAffinity(profile: TaskProfile, model: ModelInfo): number {
  const q = qualityBase(model);
  switch (profile.taskType) {
    case "planning":
    case "review":
      return q + (model.contextLimit >= 100000 ? 0.05 : 0);
    case "documentation":
      return 1 - 0.5 * q;
    case "coding":
      return 0.7 * q + (model.supportsTools ? 0.15 : 0);
    case "testing":
      return 0.6 * q + 0.15;
    case "design":
    case "research":
    case "general":
    default:
      return 0.8 * q + 0.1;
  }
}

/** Hard filters — a model that fails any of these is never routed. */
export function passesHardFilters(profile: TaskProfile, model: ModelInfo): boolean {
  if (profile.forceProvider && model.provider !== profile.forceProvider) return false;
  if (profile.forceModel && model.model !== profile.forceModel) return false;
  if (profile.needsTools && !model.supportsTools) return false;
  if (profile.needsVision && !model.supportsVision) return false;
  if (profile.minContext && model.contextLimit < profile.minContext) return false;
  return true;
}

/**
 * Pure scoring function. Deterministic: no I/O, no randomness.
 * Exported for unit tests and for explaining routing decisions.
 */
export function scoreModel(profile: TaskProfile, model: ModelInfo, ctx: ScoreContext = {}): number {
  const w = profile.qualityWeight ?? 0.5; // 0 = cheapest, 1 = best quality

  const quality = taskAffinity(profile, model) * 10 * w;

  const avgPer1k = (model.inputPer1k + model.outputPer1k) / 2;
  const costPenalty = avgPer1k * 200 * (1 - w);

  // Larger models are slower; local/mock models respond (nearly) instantly.
  const isLocal = model.provider === "mock" || model.provider === "ollama";
  const latencyPenalty = (isLocal ? 0.02 : qualityBase(model) * 0.5) * (1 - w);

  const availabilityBonus = ctx.connectionStatus === "ok" ? 0.25 : 0;
  const genomeBonus = ctx.genomeSuccessRate != null ? (ctx.genomeSuccessRate - 0.5) * 0.6 : 0;

  return quality - costPenalty - latencyPenalty + availabilityBonus + genomeBonus;
}

interface Candidate {
  model: ModelInfo;
  connectionId: string;
  connectionStatus: string;
  genomeSuccessRate: number | null;
}

async function gatherCandidates(
  workspaceId: string
): Promise<Candidate[]> {
  const connections = await db.providerConnection.findMany({ where: { workspaceId } });
  if (connections.length === 0) return [];
  const genomes = await db.agentGenome.findMany({ where: { workspaceId } });

  const candidates: Candidate[] = [];
  for (const conn of connections) {
    let models: ModelInfo[];
    try {
      const config = await connectionConfig(conn.id);
      models = await getAdapter(conn.provider).listModels(config);
    } catch {
      models = FALLBACK_MODELS.filter((m) => m.provider === conn.provider);
    }
    if (models.length === 0) {
      models = FALLBACK_MODELS.filter((m) => m.provider === conn.provider);
    }
    for (const model of models) {
      // Genome bonus: a genome matching this provider/model that has learned
      // this kind of task pushes the model up.
      const matching = genomes.filter(
        (g) =>
          g.provider === model.provider &&
          g.model === model.model &&
          fromJson<string[]>(g.bestCategoriesJson, []).length >= 0
      );
      const genomeSuccessRate =
        matching.length > 0 ? Math.max(...matching.map((g) => g.successRate)) : null;
      candidates.push({
        model,
        connectionId: conn.id,
        connectionStatus: conn.status,
        genomeSuccessRate,
      });
    }
  }
  return candidates;
}

export async function routeModel(
  workspaceId: string,
  profile: TaskProfile
): Promise<RouteDecision | null> {
  const all = await gatherCandidates(workspaceId);
  if (all.length === 0) return null; // no providers connected

  const eligible = all.filter((c) => passesHardFilters(profile, c.model));
  if (eligible.length === 0) return null;

  const scored = eligible.map((c) => ({
    ...c,
    score: scoreModel(profile, c.model, {
      connectionStatus: c.connectionStatus,
      genomeSuccessRate: c.genomeSuccessRate,
    }),
  }));

  // Deterministic ordering: score desc, then cheaper, then provider, then model.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const costA = a.model.inputPer1k + a.model.outputPer1k;
    const costB = b.model.inputPer1k + b.model.outputPer1k;
    if (costA !== costB) return costA - costB;
    if (a.model.provider !== b.model.provider) {
      return a.model.provider.localeCompare(b.model.provider);
    }
    return a.model.model.localeCompare(b.model.model);
  });

  const best = scored[0];
  const reasonParts = [
    `score ${best.score.toFixed(2)} best of ${eligible.length} eligible model(s)`,
  ];
  if (profile.forceProvider) reasonParts.push(`forced provider ${profile.forceProvider}`);
  if (profile.forceModel) reasonParts.push(`forced model ${profile.forceModel}`);
  if (profile.needsTools) reasonParts.push("requires tool support");
  if (profile.needsVision) reasonParts.push("requires vision");
  if (profile.minContext) reasonParts.push(`requires context ≥ ${profile.minContext}`);
  if (best.genomeSuccessRate != null) {
    reasonParts.push(`genome success rate ${(best.genomeSuccessRate * 100).toFixed(0)}%`);
  }

  return {
    provider: best.model.provider,
    model: best.model.model,
    connectionId: best.connectionId,
    reason: `Picked ${best.model.provider}/${best.model.model}: ${reasonParts.join("; ")}.`,
    score: best.score,
  };
}
