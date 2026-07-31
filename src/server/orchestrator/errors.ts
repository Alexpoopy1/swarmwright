/**
 * Structured orchestrator error. `code` is machine-readable so API routes
 * and tests can branch on it without parsing messages.
 */
export class OrchestratorError extends Error {
  constructor(
    public code: string,
    message?: string,
    public details?: unknown,
  ) {
    super(message ?? code);
    this.name = "OrchestratorError";
  }
}
