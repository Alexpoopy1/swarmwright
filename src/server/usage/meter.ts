import type { UsageSummary } from "@/types";
import { db } from "@/server/db";
import { estimateCostUsd, refreshPricingCache } from "@/server/providers/pricing";

/**
 * Usage metering (SPEC §4.5) — every model/tool call writes a UsageRecord,
 * run/agent aggregates are incremented, and budgets are checked honestly
 * before each model call by the engine.
 */

export async function recordUsage(u: {
  workspaceId: string;
  projectId?: string;
  runId?: string;
  agentId?: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  kind: string;
}): Promise<{ costUsd: number }> {
  // Best effort: pick up ModelCost overrides; fall back to static prices.
  await refreshPricingCache().catch(() => {});
  const costUsd = estimateCostUsd(u.provider, u.model, u.tokensIn, u.tokensOut);

  await db.usageRecord.create({
    data: {
      workspaceId: u.workspaceId,
      projectId: u.projectId ?? null,
      runId: u.runId ?? null,
      agentId: u.agentId ?? null,
      provider: u.provider,
      model: u.model,
      tokensIn: u.tokensIn,
      tokensOut: u.tokensOut,
      costUsd,
      kind: u.kind,
    },
  });

  const tokens = u.tokensIn + u.tokensOut;
  if (u.runId) {
    await db.agentRun
      .update({
        where: { id: u.runId },
        data: {
          costUsd: { increment: costUsd },
          tokensUsed: { increment: tokens },
        },
      })
      .catch(() => {}); // run may be gone (deleted project) — usage row stands
  }
  if (u.agentId) {
    await db.agent
      .update({
        where: { id: u.agentId },
        data: {
          tokensIn: { increment: u.tokensIn },
          tokensOut: { increment: u.tokensOut },
          costUsd: { increment: costUsd },
        },
      })
      .catch(() => {});
  }

  return { costUsd };
}

export async function checkRunBudget(runId: string): Promise<{ ok: boolean; reason?: string }> {
  const run = await db.agentRun.findUnique({ where: { id: runId } });
  if (!run) return { ok: false, reason: "run_not_found" };
  if (run.costUsd >= run.budgetUsd) {
    return { ok: false, reason: `budget_exceeded: cost $${run.costUsd.toFixed(4)} >= budget $${run.budgetUsd.toFixed(2)}` };
  }
  if (run.tokensUsed >= run.tokenLimit) {
    return { ok: false, reason: `token_limit_exceeded: ${run.tokensUsed} >= ${run.tokenLimit}` };
  }
  return { ok: true };
}

export async function usageSummary(workspaceId: string): Promise<UsageSummary> {
  const records = await db.usageRecord.findMany({ where: { workspaceId } });

  const byProviderMap = new Map<string, { provider: string; costUsd: number; tokens: number }>();
  const byModelMap = new Map<string, { provider: string; model: string; costUsd: number; tokens: number }>();
  const byRunMap = new Map<string, { runId: string; costUsd: number; tokens: number }>();
  let totalCostUsd = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  for (const r of records) {
    const tokens = r.tokensIn + r.tokensOut;
    totalCostUsd += r.costUsd;
    totalTokensIn += r.tokensIn;
    totalTokensOut += r.tokensOut;

    const p = byProviderMap.get(r.provider) ?? { provider: r.provider, costUsd: 0, tokens: 0 };
    p.costUsd += r.costUsd;
    p.tokens += tokens;
    byProviderMap.set(r.provider, p);

    const mk = `${r.provider}/${r.model}`;
    const m = byModelMap.get(mk) ?? { provider: r.provider, model: r.model, costUsd: 0, tokens: 0 };
    m.costUsd += r.costUsd;
    m.tokens += tokens;
    byModelMap.set(mk, m);

    if (r.runId) {
      const run = byRunMap.get(r.runId) ?? { runId: r.runId, costUsd: 0, tokens: 0 };
      run.costUsd += r.costUsd;
      run.tokens += tokens;
      byRunMap.set(r.runId, run);
    }
  }

  const runIds = [...byRunMap.keys()];
  const runs = runIds.length
    ? await db.agentRun.findMany({ where: { id: { in: runIds } }, select: { id: true, goal: true } })
    : [];
  const goalByRun = new Map(runs.map((r) => [r.id, r.goal]));

  // Runs belonging to this workspace (for tool-execution/retry counts).
  const wsRuns = await db.agentRun.findMany({
    where: { project: { workspaceId } },
    select: { id: true },
  });
  const wsRunIds = wsRuns.map((r) => r.id);
  const toolExecutions = wsRunIds.length
    ? await db.toolExecution.count({ where: { runId: { in: wsRunIds } } })
    : 0;
  const retries = wsRunIds.length
    ? await db.event.count({ where: { type: "TASK_RETRIED", runId: { in: wsRunIds } } })
    : 0;

  return {
    totalCostUsd,
    totalTokensIn,
    totalTokensOut,
    byProvider: [...byProviderMap.values()].sort((a, b) => b.costUsd - a.costUsd),
    byModel: [...byModelMap.values()].sort((a, b) => b.costUsd - a.costUsd),
    byRun: [...byRunMap.values()]
      .map((r) => ({ ...r, goal: goalByRun.get(r.runId) ?? "" }))
      .sort((a, b) => b.costUsd - a.costUsd),
    toolExecutions,
    retries,
  };
}
