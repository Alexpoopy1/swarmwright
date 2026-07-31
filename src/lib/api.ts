/**
 * Typed fetch wrapper for the Swarmwright REST API.
 * Throws ApiError with the server-provided message on non-2xx.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      ...init,
    });
  } catch {
    throw new ApiError("Network error — could not reach the server", 0);
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      if (body?.error) message = body.error;
      if (body?.code) code = body.code;
    } catch {
      // non-JSON error body — keep default message
    }
    throw new ApiError(message, res.status, code);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export function get<T = unknown>(path: string): Promise<T> {
  return api<T>(path, { method: "GET" });
}

export function post<T = unknown>(path: string, body?: unknown): Promise<T> {
  return api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
}

export function patch<T = unknown>(path: string, body?: unknown): Promise<T> {
  return api<T>(path, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) });
}

export function del<T = unknown>(path: string): Promise<T> {
  return api<T>(path, { method: "DELETE" });
}
