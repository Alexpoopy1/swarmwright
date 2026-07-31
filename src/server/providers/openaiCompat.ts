import type {
  ChatChunk,
  ChatParams,
  ModelInfo,
  ProviderAdapter,
  ProviderConnectionConfig,
} from "@/types";
import { ProviderError } from "@/server/providers/errors";
import { FALLBACK_MODELS } from "@/server/providers/pricing";

/**
 * OpenAI-compatible adapter (SPEC §4.3) — works for OpenAI, OpenRouter, Groq,
 * DeepSeek, Ollama and any custom "openai-compatible" endpoint.
 *
 * - POST {baseUrl}/chat/completions, `Authorization: Bearer <apiKey>` when present.
 * - Streaming parses SSE `data:` frames until `[DONE]`.
 * - jsonMode → `response_format: { type: "json_object" }` (best effort).
 * - Errors are normalized to ProviderError: 401/403→auth, 429→rate_limit,
 *   5xx→provider_error, network failures→unreachable.
 */

export const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
  deepseek: "https://api.deepseek.com/v1",
  ollama: "http://localhost:11434/v1",
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function baseUrlFor(config: ProviderConnectionConfig): string {
  const url = config.baseUrl ?? DEFAULT_BASE_URLS[config.provider];
  if (!url) {
    throw new ProviderError(
      "provider_error",
      `No baseUrl configured for provider "${config.provider}"`,
      false
    );
  }
  return url.replace(/\/+$/, "");
}

function headersFor(config: ProviderConnectionConfig): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;
  return headers;
}

async function normalizeHttpError(res: Response): Promise<never> {
  const body = await res.text().catch(() => "");
  const detail = body ? `: ${body.slice(0, 300)}` : "";
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError("auth", `Authentication failed (HTTP ${res.status})${detail}`, false);
  }
  if (res.status === 429) {
    throw new ProviderError("rate_limit", `Rate limited (HTTP 429)${detail}`, true);
  }
  if (res.status >= 500) {
    throw new ProviderError("provider_error", `Provider error (HTTP ${res.status})${detail}`, true);
  }
  throw new ProviderError("provider_error", `Request failed (HTTP ${res.status})${detail}`, false);
}

function normalizeNetworkError(err: unknown): never {
  if (err instanceof ProviderError) throw err;
  if (err instanceof Error && err.name === "AbortError") throw err;
  const msg = err instanceof Error ? err.message : String(err);
  throw new ProviderError("unreachable", `Provider unreachable: ${msg}`, true);
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAICompatAdapter implements ProviderAdapter {
  readonly provider: string;

  constructor(provider: string) {
    this.provider = provider;
  }

  private requestBody(params: ChatParams, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: params.model,
      messages: params.messages.map((m) => {
        const msg: Record<string, unknown> = { role: m.role, content: m.content };
        if (m.name) msg.name = m.name;
        return msg;
      }),
      stream,
    };
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;
    if (params.jsonMode) {
      // Best effort: some compatible servers reject response_format.
      try {
        body.response_format = { type: "json_object" };
      } catch {
        // ignore — jsonMode stays a prompt-level instruction
      }
    }
    return body;
  }

  async complete(
    config: ProviderConnectionConfig,
    params: ChatParams
  ): Promise<{ content: string; tokensIn: number; tokensOut: number }> {
    let res: Response;
    try {
      res = await fetch(`${baseUrlFor(config)}/chat/completions`, {
        method: "POST",
        headers: headersFor(config),
        body: JSON.stringify(this.requestBody(params, false)),
        signal: params.signal,
      });
    } catch (err) {
      normalizeNetworkError(err);
    }
    if (!res.ok) await normalizeHttpError(res);

    let data: ChatCompletionResponse;
    try {
      data = (await res.json()) as ChatCompletionResponse;
    } catch {
      throw new ProviderError("invalid_response", "Provider returned non-JSON response", false);
    }
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new ProviderError("invalid_response", "Response missing choices[0].message.content", false);
    }
    const input = params.messages.map((m) => m.content).join("\n");
    return {
      content,
      tokensIn: data.usage?.prompt_tokens ?? estimateTokens(input),
      tokensOut: data.usage?.completion_tokens ?? estimateTokens(content),
    };
  }

  async *stream(
    config: ProviderConnectionConfig,
    params: ChatParams
  ): AsyncGenerator<ChatChunk, void, unknown> {
    let res: Response;
    try {
      res = await fetch(`${baseUrlFor(config)}/chat/completions`, {
        method: "POST",
        headers: headersFor(config),
        body: JSON.stringify(this.requestBody(params, true)),
        signal: params.signal,
      });
    } catch (err) {
      normalizeNetworkError(err);
    }
    if (!res.ok) await normalizeHttpError(res);
    if (!res.body) {
      throw new ProviderError("invalid_response", "Streaming response has no body", false);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let tokensIn: number | undefined;
    let tokensOut: number | undefined;
    let emitted = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by blank lines; each frame has `data:` lines.
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of frame.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") {
            yield {
              delta: "",
              done: true,
              usage:
                tokensIn !== undefined || tokensOut !== undefined
                  ? {
                      tokensIn: tokensIn ?? estimateTokens(params.messages.map((m) => m.content).join("\n")),
                      tokensOut: tokensOut ?? estimateTokens(emitted),
                    }
                  : undefined,
            };
            return;
          }
          let parsed: {
            choices?: Array<{ delta?: { content?: string } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue; // ignore malformed keep-alive frames
          }
          if (parsed.usage) {
            tokensIn = parsed.usage.prompt_tokens ?? tokensIn;
            tokensOut = parsed.usage.completion_tokens ?? tokensOut;
          }
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            emitted += delta;
            yield { delta, done: false };
          }
        }
      }
    }

    // Stream ended without an explicit [DONE].
    yield {
      delta: "",
      done: true,
      usage: {
        tokensIn: tokensIn ?? estimateTokens(params.messages.map((m) => m.content).join("\n")),
        tokensOut: tokensOut ?? estimateTokens(emitted),
      },
    };
  }

  async listModels(config: ProviderConnectionConfig): Promise<ModelInfo[]> {
    const fallback = FALLBACK_MODELS.filter((m) => m.provider === this.provider);
    let res: Response;
    try {
      res = await fetch(`${baseUrlFor(config)}/models`, {
        method: "GET",
        headers: headersFor(config),
      });
    } catch {
      return fallback; // unreachable → static metadata
    }
    if (!res.ok) return fallback;

    let data: { data?: Array<{ id?: string }> };
    try {
      data = (await res.json()) as { data?: Array<{ id?: string }> };
    } catch {
      return fallback;
    }
    const ids = (data.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (ids.length === 0) return fallback;

    const known = new Map(FALLBACK_MODELS.map((m) => [m.model, m]));
    return ids.map((id) => {
      const meta = known.get(id);
      return (
        meta ?? {
          provider: this.provider,
          model: id,
          label: id,
          contextLimit: 128000,
          supportsTools: true,
          supportsVision: false,
          supportsStreaming: true,
          inputPer1k: 0,
          outputPer1k: 0,
        }
      );
    });
  }

  async testConnection(config: ProviderConnectionConfig): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${baseUrlFor(config)}/models`, {
        method: "GET",
        headers: headersFor(config),
      });
      if (!res.ok) {
        const err = await normalizeHttpError(res).catch((e: unknown) => e);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
