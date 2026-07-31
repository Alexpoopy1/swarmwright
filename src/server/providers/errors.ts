/**
 * Normalized provider error (SPEC §4.3). Every adapter throws this instead of
 * raw fetch/HTTP errors so callers can react to `code`/`retryable` uniformly.
 */
export class ProviderError extends Error {
  constructor(
    public code: "auth" | "rate_limit" | "provider_error" | "unreachable" | "invalid_response",
    msg: string,
    public retryable: boolean
  ) {
    super(msg);
    this.name = "ProviderError";
  }
}
