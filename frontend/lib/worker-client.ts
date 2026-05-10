// frontend/lib/worker-client.ts
// Typed client for the Sovereign AI Switchboard Worker.
// All hooks import from this module — never call fetch() directly.

const WORKER_URL =
  process.env.NEXT_PUBLIC_WORKER_URL ?? "https://api.sovereign.os";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DispatchOptions {
  space: string;
  userId: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface WorkerError {
  error: string;
  code: string;
  details?: unknown;
  request_id?: string;
}

export type WorkerResult<T> =
  | { ok: true; data: T; requestId: string | null }
  | { ok: false; error: WorkerError; status: number; requestId: string | null };

// ─── Retry config ─────────────────────────────────────────────────────────────

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 800;
const RETRYABLE_STATUSES = [500, 502, 503, 504];

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ─── Core dispatch ────────────────────────────────────────────────────────────

export async function workerDispatch<T = unknown>(
  opts: DispatchOptions
): Promise<WorkerResult<T>> {
  const { space, userId, payload, idempotencyKey, signal } = opts;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;

  const body = JSON.stringify({
    space,
    user_id: userId,
    payload,
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
  });

  let lastStatus = 0;
  let lastError: WorkerError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_DELAY_MS * attempt);
    }

    try {
      const res = await fetch(`${WORKER_URL}/dispatch`, {
        method: "POST",
        headers,
        body,
        signal,
        credentials: "include",
      });

      const requestId = res.headers.get("X-Request-ID");

      if (res.ok) {
        const data = (await res.json()) as T;
        return { ok: true, data, requestId };
      }

      lastStatus = res.status;
      const errBody = await res.json().catch(() => ({
        error: "Unknown error",
        code: "UNKNOWN",
      })) as WorkerError;
      lastError = errBody;

      // Don't retry non-5xx errors (4xx are definitive)
      if (!RETRYABLE_STATUSES.includes(res.status)) {
        return { ok: false, error: errBody, status: res.status, requestId };
      }

      // Last attempt — return the error
      if (attempt === MAX_RETRIES) {
        return { ok: false, error: errBody, status: res.status, requestId };
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return {
          ok: false,
          error: { error: "Request cancelled", code: "ABORTED" },
          status: 0,
          requestId: null,
        };
      }
      // Network error — retry
      lastStatus = 0;
      lastError = { error: "Network error", code: "NETWORK_ERROR" };
      if (attempt === MAX_RETRIES) {
        return {
          ok: false,
          error: lastError,
          status: 0,
          requestId: null,
        };
      }
    }
  }

  return {
    ok: false,
    error: lastError ?? { error: "Unknown error", code: "UNKNOWN" },
    status: lastStatus,
    requestId: null,
  };
}

// ─── Streaming dispatch ───────────────────────────────────────────────────────

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onDone?: (usage?: { input_tokens?: number; output_tokens?: number }) => void;
  onError?: (error: string) => void;
}

export async function workerStream(
  opts: DispatchOptions,
  callbacks: StreamCallbacks
): Promise<void> {
  const { space, userId, payload, signal } = opts;

  const res = await fetch(`${WORKER_URL}/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ space, user_id: userId, payload }),
    signal,
    credentials: "include",
  });

  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({ error: "Stream failed", code: "STREAM_ERROR" })) as WorkerError;
    callbacks.onError?.(err.error);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") {
        callbacks.onDone?.();
        return;
      }
      try {
        const parsed = JSON.parse(data) as { text?: string; usage?: unknown; error?: string };
        if (parsed.error) {
          callbacks.onError?.(parsed.error);
          return;
        }
        if (parsed.text) callbacks.onChunk(parsed.text);
      } catch {
        // Ignore malformed SSE lines
      }
    }
  }

  callbacks.onDone?.();
}

// ─── Health check ─────────────────────────────────────────────────────────────

export async function workerHealth(): Promise<{
  status: "healthy" | "degraded" | "unhealthy";
  checks: Record<string, string>;
} | null> {
  try {
    const res = await fetch(`${WORKER_URL}/health`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return res.json() as Promise<{ status: "healthy" | "degraded" | "unhealthy"; checks: Record<string, string> }>;
  } catch {
    return null;
  }
}

// ─── User-facing error messages ───────────────────────────────────────────────

export function friendlyError(error: WorkerError, status: number): string {
  if (status === 0) return "We couldn't reach the server. Check your connection and try again.";
  if (status === 429) return error.error; // already user-friendly from Worker
  if (status === 403) return "This feature is available on the Pro plan. Upgrade to unlock it.";
  if (status === 422) return "Something doesn't look right in your input. Please review and try again.";
  if (status >= 500) return "Something went wrong on our end. Please try again in a moment.";
  return "Something unexpected happened. Please try again.";
}
