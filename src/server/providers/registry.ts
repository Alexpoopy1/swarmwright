import type { ModelInfo, ProviderAdapter, ProviderConnectionConfig } from "@/types";
import { db } from "@/server/db";
import { decryptSecret } from "@/server/crypto/secrets";
import { fromJson } from "@/server/json";
import { mockProvider } from "@/server/providers/mock";
import { OpenAICompatAdapter } from "@/server/providers/openaiCompat";
import { FALLBACK_MODELS } from "@/server/providers/pricing";

/**
 * Provider registry (SPEC §4.3).
 *
 * "anthropic" is served through the OpenAI-compatible adapter with a
 * user-supplied baseUrl (documented in docs/PROVIDERS.md; a native adapter is
 * roadmap). Unknown provider names also fall back to the OpenAI-compatible
 * adapter so custom gateways work without code changes.
 */

const adapters = new Map<string, ProviderAdapter>();

export function getAdapter(provider: string): ProviderAdapter {
  if (provider === "mock") return mockProvider;
  let adapter = adapters.get(provider);
  if (!adapter) {
    adapter = new OpenAICompatAdapter(provider);
    adapters.set(provider, adapter);
  }
  return adapter;
}

/**
 * Load a ProviderConnection row and decrypt its secret server-side.
 * The result must never be serialized to the client (contains apiKey).
 */
export async function connectionConfig(connectionId: string): Promise<ProviderConnectionConfig> {
  const row = await db.providerConnection.findUnique({ where: { id: connectionId } });
  if (!row) throw new Error(`Provider connection not found: ${connectionId}`);
  let apiKey: string | null = null;
  if (row.encryptedSecret) {
    try {
      apiKey = decryptSecret(row.encryptedSecret);
    } catch {
      throw new Error(`Could not decrypt secret for connection ${connectionId}`);
    }
  }
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    baseUrl: row.baseUrl,
    apiKey,
    metadata: fromJson<Record<string, unknown>>(row.metadataJson, {}),
  };
}

/** Models for a connection: adapter first, FALLBACK_MODELS as safety net. */
export async function listConnectionModels(connectionId: string): Promise<ModelInfo[]> {
  const config = await connectionConfig(connectionId);
  try {
    const models = await getAdapter(config.provider).listModels(config);
    if (models.length > 0) return models;
  } catch {
    // fall through to static metadata
  }
  return FALLBACK_MODELS.filter((m) => m.provider === config.provider);
}
