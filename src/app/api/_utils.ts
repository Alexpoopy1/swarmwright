import { NextResponse } from "next/server";
import { z } from "zod";
import type { AgentGenome, ProviderConnection } from "@prisma/client";
import { AuthError, SESSION_COOKIE, getDefaultWorkspaceId } from "@/server/auth";
import { fromJson } from "@/server/json";

/**
 * Shared helpers for the Swarmwright API surface (SPEC §5):
 * JSON responses, zod body parsing, auth/workspace plumbing, SSE framing,
 * and a single error mapper so every route fails the same way.
 */

const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 days

/** JSON response. */
export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/** Error carrying an HTTP status, thrown by route helpers. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Parse + zod-validate a JSON request body → 400 with the first issue message. */
export async function parseBody<S extends z.ZodTypeAny>(
  req: Request,
  schema: S
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    throw new HttpError(400, `${where}${issue?.message ?? "Invalid request body"}`);
  }
  return parsed.data;
}

/** The caller's default workspace — every resource is workspace-scoped. */
export async function workspaceIdOf(userId: string): Promise<string> {
  return getDefaultWorkspaceId(userId);
}

/** Uniform error mapping: auth → 401, HttpError → its status, zod → 400, else 500. */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    if (err.code === "unauthorized") return json({ error: "unauthorized", code: err.code }, 401);
    if (err.code === "invalid_credentials") return json({ error: err.message, code: err.code }, 401);
    return json({ error: err.message, code: err.code }, 400);
  }
  if (err instanceof HttpError) {
    return json({ error: err.message, code: err.code }, err.status);
  }
  if (err instanceof z.ZodError) {
    const issue = err.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return json({ error: `${where}${issue?.message ?? "Validation failed"}` }, 400);
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  console.error("[api] unhandled error:", err);
  return json({ error: message }, 500);
}

/** httpOnly session cookie, sameSite=lax, path=/, 30-day maxAge (SPEC §4.1). */
export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

// ── SSE ──────────────────────────────────────────────────────

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;

export function sseResponse(readable: ReadableStream<Uint8Array>): Response {
  return new Response(readable, { headers: SSE_HEADERS });
}

/** One SSE data frame: `data: <json>\n\n`. */
export function sseFrame(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/** Numeric query param helper (`?afterSeq&limit`). */
export function queryInt(url: URL, key: string): number | undefined {
  const raw = url.searchParams.get(key);
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Client-safe view of a ProviderConnection. The encrypted secret NEVER
 * leaves the server; the UI only sees the masked hint stored at creation
 * time (metadataJson.maskedHint).
 */
export function connectionDto(row: ProviderConnection) {
  const meta = fromJson<Record<string, unknown>>(row.metadataJson, {});
  const maskedHint = typeof meta.maskedHint === "string" ? meta.maskedHint : null;
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    authType: row.authType,
    baseUrl: row.baseUrl,
    status: row.status,
    secretMasked: maskedHint,
    maskedHint,
    metadataJson: maskedHint ? { maskedHint } : {},
    lastCheckedAt: row.lastCheckedAt,
    createdAt: row.createdAt,
  };
}

/** Client view of a genome: JSON columns parsed + UI-friendly aliases. */
export function genomeDto(row: AgentGenome) {
  return {
    ...row,
    toolProfile: fromJson<unknown[]>(row.toolProfileJson, []),
    failurePatterns: fromJson<string[]>(row.failurePatternsJson, []),
    bestCategories: fromJson<string[]>(row.bestCategoriesJson, []),
    role: row.roleDescription,
    runsCount: row.runs,
    runCount: row.runs,
  };
}
