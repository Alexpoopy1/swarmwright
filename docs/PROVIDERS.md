# Provider Guide

Swarmwright connects to AI providers through a normalized adapter interface. Keys are encrypted at rest (AES-256-GCM) and only ever used server-side.

## Supported connections

| Provider | Auth | Base URL (default) | Notes |
|---|---|---|---|
| **Mock (offline)** | none | — | Built-in. Deterministic plans, agent actions and chat — the entire platform works without a key. Powers the demo and the test suite. |
| OpenAI | API key | `https://api.openai.com/v1` | Any GPT-* chat model. |
| OpenRouter | API key | `https://openrouter.ai/api/v1` | One key, many models. |
| Groq | API key | `https://api.groq.com/openai/v1` | Fast Llama/Mixtral inference. |
| DeepSeek | API key | `https://api.deepseek.com/v1` | |
| Ollama | none | `http://localhost:11434/v1` | Local models via Ollama's OpenAI-compatible endpoint. |
| OpenAI-compatible | API key / none | custom | vLLM, LM Studio, Together, Mistral La Plateforme, etc. |

Anthropic: use an OpenAI-compatible gateway or see ROADMAP (native adapter). OAuth-based connections are on the roadmap; today all connections are API-key based.

## Connect a provider

UI: **Providers → Add connection** → pick provider, label, paste key (optional custom Base URL) → **Test connection**.

API:

```bash
curl -X POST localhost:3000/api/providers \
  -H "Content-Type: application/json" -b cookies.txt \
  -d '{"provider":"openai","label":"My OpenAI","apiKey":"sk-..."}'
```

The response and all future reads return only a masked hint (`sk-…wxyz`). The raw key is encrypted and never leaves the server.

## How routing picks models

The router (`src/server/router`) scores every model of every healthy connection for each task profile:

1. **Hard filters** — manual override (`forceProvider`/`forceModel`), tool-calling support, vision, minimum context size.
2. **Score** — quality heuristic per task type (planning/review favor stronger models; documentation favors fast/cheap ones) − cost penalty − latency penalty + availability bonus + **genome bonus** (historical success of that model for the role/category).

Routing is deterministic and unit-tested. You can always override per-run or per-message.

## Writing an adapter

Implement `ProviderAdapter` (see `src/types/index.ts`):

```ts
export const myAdapter: ProviderAdapter = {
  provider: "myprovider",
  async listModels(config) { /* GET models, map to ModelInfo[] */ },
  async testConnection(config) { /* cheap call, return {ok} */ },
  async complete(config, params) { /* one-shot chat completion */ },
  async *stream(config, params) { /* yield ChatChunk deltas */ },
};
```

Register it in `src/server/providers/registry.ts`. Normalize errors to `ProviderError(code, retryable)` so the engine can fall back (`"auth" | "rate_limit" | "provider_error" | "unreachable" | "invalid_response"`). See `openaiCompat.ts` and `mock.ts` for reference implementations, and `tests/` for adapter test patterns.

## Cost metadata

`ModelCost` rows (+ static fallback table in `pricing.ts`) drive cost estimation shown across the app. Community PRs to keep the fallback table current are welcome — see CONTRIBUTING.
