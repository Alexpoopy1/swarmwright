import { db } from "@/server/db";
import type { ModelInfo } from "@/types";

/**
 * Static model metadata + cost estimation (SPEC §4.3/§4.5).
 *
 * `estimateCostUsd` is synchronous (binding signature). DB overrides from the
 * ModelCost table are loaded into a module-level cache via
 * `refreshPricingCache()`; callers that can await (e.g. usage metering)
 * refresh first, everything else falls back to FALLBACK_MODELS prices.
 */

export const FALLBACK_MODELS: ModelInfo[] = [
  {
    provider: "openai",
    model: "gpt-4o",
    label: "GPT-4o",
    contextLimit: 128000,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    inputPer1k: 0.005,
    outputPer1k: 0.015,
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    label: "GPT-4o mini",
    contextLimit: 128000,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    inputPer1k: 0.00015,
    outputPer1k: 0.0006,
  },
  {
    provider: "anthropic",
    model: "claude-3-5-sonnet-20241022",
    label: "Claude 3.5 Sonnet",
    contextLimit: 200000,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    inputPer1k: 0.003,
    outputPer1k: 0.015,
  },
  {
    provider: "groq",
    model: "llama-3.1-70b-versatile",
    label: "Llama 3.1 70B (Groq)",
    contextLimit: 131072,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    inputPer1k: 0.00059,
    outputPer1k: 0.00079,
  },
  {
    provider: "deepseek",
    model: "deepseek-chat",
    label: "DeepSeek Chat",
    contextLimit: 64000,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    inputPer1k: 0.00014,
    outputPer1k: 0.00028,
  },
  {
    provider: "ollama",
    model: "llama3.1",
    label: "Llama 3.1 8B (local)",
    contextLimit: 131072,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    inputPer1k: 0,
    outputPer1k: 0,
  },
  {
    provider: "mock",
    model: "mock-planner-1",
    label: "Mock Planner (offline)",
    contextLimit: 32768,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    inputPer1k: 0,
    outputPer1k: 0,
  },
  {
    provider: "mock",
    model: "mock-coder-1",
    label: "Mock Coder (offline)",
    contextLimit: 32768,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    inputPer1k: 0,
    outputPer1k: 0,
  },
  {
    provider: "mock",
    model: "mock-fast-1",
    label: "Mock Fast (offline)",
    contextLimit: 32768,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    inputPer1k: 0,
    outputPer1k: 0,
  },
];

export function fallbackModel(provider: string, model: string): ModelInfo | undefined {
  return FALLBACK_MODELS.find((m) => m.provider === provider && m.model === model);
}

type CostEntry = { inputPer1k: number; outputPer1k: number };
let costOverrides: Map<string, CostEntry> | null = null;
const keyOf = (provider: string, model: string) => `${provider}/${model}`;

/** Load ModelCost rows into the in-memory cache (best effort, idempotent). */
export async function refreshPricingCache(): Promise<void> {
  const rows = await db.modelCost.findMany();
  const map = new Map<string, CostEntry>();
  for (const r of rows) {
    map.set(keyOf(r.provider, r.model), {
      inputPer1k: r.inputPer1k,
      outputPer1k: r.outputPer1k,
    });
  }
  costOverrides = map;
}

/**
 * Cost in USD for a call. Looks up ModelCost (when the cache has been
 * refreshed), then FALLBACK_MODELS, then 0 for unknown models.
 */
export function estimateCostUsd(
  provider: string,
  model: string,
  tokensIn: number,
  tokensOut: number
): number {
  const entry =
    costOverrides?.get(keyOf(provider, model)) ??
    (() => {
      const fb = fallbackModel(provider, model);
      return fb ? { inputPer1k: fb.inputPer1k, outputPer1k: fb.outputPer1k } : undefined;
    })();
  if (!entry) return 0;
  return (tokensIn / 1000) * entry.inputPer1k + (tokensOut / 1000) * entry.outputPer1k;
}
