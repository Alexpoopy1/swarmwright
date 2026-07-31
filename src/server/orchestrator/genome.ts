import { db } from "@/server/db";
import { emitEvent } from "@/server/events/store";
import { fromJson, toJson } from "@/server/json";
import type { AgentGenome } from "@prisma/client";

/**
 * Agent Genome — transparent performance learning over agent configurations
 * (SPEC §4.6). Learning is a simple, auditable EMA (α = 0.3) over success
 * rate, latency, and cost; nothing hidden, no chain-of-thought stored.
 */

const EMA_ALPHA = 0.3;
const FAILURE_PATTERNS_CAP = 10;
const BEST_CATEGORIES_CAP = 8;
const MIN_RUNS_FOR_MATCH = 3;

/**
 * Best genome for a role/taskType: requires >= 3 recorded runs, matches the
 * role (name or roleDescription) and optionally the task category in
 * bestCategories. Highest successRate wins; category match breaks ties.
 */
export async function matchGenome(
  workspaceId: string,
  role: string,
  taskType: string,
): Promise<AgentGenome | null> {
  const genomes = await db.agentGenome.findMany({
    where: { workspaceId, runs: { gte: MIN_RUNS_FOR_MATCH } },
  });
  const needle = role.toLowerCase();
  const candidates = genomes.filter((g) => {
    const hay = `${g.name} ${g.roleDescription}`.toLowerCase();
    return hay.includes(needle) || needle.includes(g.name.toLowerCase());
  });
  if (candidates.length === 0) return null;

  const scored = candidates.map((g) => {
    const categories = fromJson<string[]>(g.bestCategoriesJson, []);
    const categoryBonus = categories.includes(taskType) ? 0.05 : 0;
    return { g, score: g.successRate + categoryBonus };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].g;
}

/**
 * Seed the six default genomes on mock-provider models so the demo works
 * fully offline. Idempotent: a workspace that already has genomes is skipped.
 */
export async function seedDefaultGenomes(workspaceId: string): Promise<void> {
  const existing = await db.agentGenome.count({ where: { workspaceId } });
  if (existing > 0) return;

  const defaults: Array<{
    name: string;
    roleDescription: string;
    model: string;
    systemPrompt: string;
  }> = [
    {
      name: "planner",
      roleDescription: "Breaks goals into structured execution plans and task graphs.",
      model: "mock-planner-1",
      systemPrompt: "You are a meticulous planning specialist. Produce structured, dependency-aware plans.",
    },
    {
      name: "architect",
      roleDescription: "Designs system architecture, data models, and API boundaries.",
      model: "mock-planner-1",
      systemPrompt: "You are a senior software architect. Favor simple, explicit, testable designs.",
    },
    {
      name: "coder",
      roleDescription: "Implements features and fixes across frontend and backend code.",
      model: "mock-coder-1",
      systemPrompt: "You are a pragmatic engineer. Write small, correct, well-named modules.",
    },
    {
      name: "reviewer",
      roleDescription: "Reviews code for correctness, security, and maintainability.",
      model: "mock-coder-1",
      systemPrompt: "You are a rigorous code reviewer. Flag concrete issues with fixes.",
    },
    {
      name: "tester",
      roleDescription: "Writes and runs tests; verifies behavior against requirements.",
      model: "mock-fast-1",
      systemPrompt: "You are a testing specialist. Cover happy paths, edges, and regressions.",
    },
    {
      name: "documentation",
      roleDescription: "Writes user-facing docs, READMEs, and inline documentation.",
      model: "mock-fast-1",
      systemPrompt: "You are a technical writer. Be concise, accurate, and example-driven.",
    },
  ];

  await db.agentGenome.createMany({
    data: defaults.map((d) => ({
      workspaceId,
      name: d.name,
      roleDescription: d.roleDescription,
      provider: "mock",
      model: d.model,
      systemPrompt: d.systemPrompt,
      temperature: 0.3,
    })),
  });
}

/**
 * Record the outcome of an agent's task into its genome.
 * Skipped entirely when the genome is locked or learning is disabled.
 */
export async function recordRunOutcome(
  agentId: string,
  outcome: {
    success: boolean;
    latencyMs: number;
    costUsd: number;
    failurePattern?: string;
    taskCategory: string;
  },
): Promise<void> {
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent?.genomeId) return;

  const genome = await db.agentGenome.findUnique({ where: { id: agent.genomeId } });
  if (!genome || genome.locked || !genome.learningEnabled) return;

  const ema = (prev: number, sample: number) => EMA_ALPHA * sample + (1 - EMA_ALPHA) * prev;

  const failurePatterns = fromJson<string[]>(genome.failurePatternsJson, []);
  if (!outcome.success && outcome.failurePattern) {
    const pattern = outcome.failurePattern.slice(0, 200);
    if (!failurePatterns.includes(pattern)) failurePatterns.push(pattern);
  }
  const trimmedFailures = failurePatterns.slice(-FAILURE_PATTERNS_CAP);

  let bestCategories = fromJson<string[]>(genome.bestCategoriesJson, []);
  if (outcome.success && outcome.taskCategory) {
    // Most-recently-successful last; deduplicated; capped.
    bestCategories = bestCategories.filter((c) => c !== outcome.taskCategory);
    bestCategories.push(outcome.taskCategory);
    bestCategories = bestCategories.slice(-BEST_CATEGORIES_CAP);
  }

  const updated = await db.agentGenome.update({
    where: { id: genome.id },
    data: {
      successRate: ema(genome.successRate, outcome.success ? 1 : 0),
      avgLatencyMs: ema(genome.avgLatencyMs, outcome.latencyMs),
      avgCostUsd: ema(genome.avgCostUsd, outcome.costUsd),
      runs: genome.runs + 1,
      failurePatternsJson: toJson(trimmedFailures),
      bestCategoriesJson: toJson(bestCategories),
    },
  });

  await emitEvent({
    runId: agent.runId,
    type: "GENOME_UPDATED",
    actorType: "system",
    summary: `Genome "${updated.name}" learned from ${outcome.success ? "a success" : "a failure"} (${outcome.taskCategory})`,
    payload: {
      genomeId: updated.id,
      agentId,
      success: outcome.success,
      taskCategory: outcome.taskCategory,
      successRate: updated.successRate,
      runs: updated.runs,
    },
  });
}
