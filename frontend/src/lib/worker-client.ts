/**
 * worker-client.ts
 * Typed fetch client for the Sovereign AI Switchboard Worker.
 * Used by all frontend hooks — replaces internal /api/* calls.
 *
 * Features:
 *  - Automatic retry with exponential backoff on 5xx responses
 *  - 5xx fallback: queues request and surfaces friendly UX error
 *  - SSE / NDJSON streaming helpers
 *  - Idempotency key injection
 */

import { nanoid } from "nanoid";

// ─── Config ───────────────────────────────────────────────────────────────────

const WORKER_BASE_URL =
  process.env.NEXT_PUBLIC_WORKER_URL ?? "https://api.sovereign.os";

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

// ─── Types ────────────────────────────────────────────────────────────────────

export type DispatchOperation = "alignment" | "compression" | "simulator" | "embed";

export interface DispatchOptions {
  operation: DispatchOperation;
  payload: Record<string, unknown>;
  /** If true, the request will stream SSE events via the returned AsyncGenerator */
  stream?: boolean;
  /** Override idempotency key (auto-generated if omitted) */
  idempotencyKey?: string;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

export interface WorkerError {
  code: string;
  message: string;
  retryable: boolean;
  request_id?: string;
}

export class WorkerRequestError extends Error {
  constructor(
    message: string,
    public readonly error: WorkerError,
    public readonly status: number
  ) {
    super(message);
    this.name = "WorkerRequestError";
  }

  get retryable(): boolean {
    return this.error.retryable;
  }
}

export class WorkerUnavailableError extends Error {
  constructor(
    public readonly queued: boolean = false,
    public readonly requestId: string = nanoid()
  ) {
    super("Worker is temporarily unavailable. Your request has been queued.");
    this.name = "WorkerUnavailableError";
  }
}

// ─── Retry queue (in-memory; replace with IndexedDB/localStorage for persistence) ─

interface QueuedRequest {
  id: string;
  operation: DispatchOperation;
  payload: Record<string, unknown>;
  timestamp: number;
  attempts: number;
}

const retryQueue: QueuedRequest[] = [];

export function getRetryQueue(): Readonly<QueuedRequest[]> {
  return retryQueue;
}

export function clearRetryQueue(): void {
  retryQueue.length = 0;
}

function enqueueRequest(operation: DispatchOperation, payload: Record<string, unknown>): string {
  const id = nanoid();
  retryQueue.push({ id, operation, payload, timestamp: Date.now(), attempts: 0 });
  // Persist to localStorage for page-reload resilience
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem("sovereign_retry_queue", JSON.stringify(retryQueue));
    } catch {
      /* non-fatal */
    }
  }
  return id;
}

// ─── Core fetch ───────────────────────────────────────────────────────────────

async function workerFetch(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  const idempotencyKey = (extraHeaders["X-Idempotency-Key"] as string) ?? nanoid();

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 100;
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      const response = await fetch(`${WORKER_BASE_URL}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKey,
          ...extraHeaders,
        },
        body: JSON.stringify(body),
        signal,
      });

      // Don't retry 4xx — those are client errors
      if (response.status >= 400 && response.status < 500) {
        return response;
      }

      // Retry 5xx
      if (response.status >= 500 && attempt < MAX_RETRIES) {
        lastError = new Error(`Worker returned ${response.status}`);
        continue;
      }

      return response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Don't retry aborted requests
      if (signal?.aborted) break;
      if (attempt === MAX_RETRIES) break;
    }
  }

  throw lastError ?? new Error("Worker fetch failed");
}

// ─── dispatch() — non-streaming ───────────────────────────────────────────────

export async function dispatch<T = unknown>(opts: DispatchOptions): Promise<T> {
  const { operation, payload, idempotencyKey, signal } = opts;

  let response: Response;

  try {
    response = await workerFetch(
      "/dispatch",
      { operation, payload },
      signal,
      idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}
    );
  } catch (err) {
    // Network error or exhausted retries — queue for later
    const queueId = enqueueRequest(operation, payload);
    throw new WorkerUnavailableError(true, queueId);
  }

  if (!response.ok) {
    let errorBody: { error?: WorkerError };
    try {
      errorBody = await response.json();
    } catch {
      errorBody = {
        error: {
          code: "UNKNOWN_ERROR",
          message: `Worker returned ${response.status}`,
          retryable: response.status >= 500,
        },
      };
    }

    // 5xx — queue and surface friendly error
    if (response.status >= 500) {
      const queueId = enqueueRequest(operation, payload);
      throw new WorkerUnavailableError(true, queueId);
    }

    throw new WorkerRequestError(
      errorBody.error?.message ?? "Worker request failed",
      errorBody.error ?? {
        code: "UNKNOWN_ERROR",
        message: "Unknown error",
        retryable: false,
      },
      response.status
    );
  }

  return response.json() as Promise<T>;
}

// ─── dispatchStream() — SSE streaming ────────────────────────────────────────

export async function* dispatchStream(
  opts: DispatchOptions
): AsyncGenerator<{ type: "delta" | "usage" | "error" | "done"; data: unknown }> {
  const { operation, payload, idempotencyKey, signal } = opts;

  let response: Response;

  try {
    response = await fetch(`${WORKER_BASE_URL}/dispatch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "X-Idempotency-Key": idempotencyKey ?? nanoid(),
      },
      body: JSON.stringify({ operation, payload: { ...payload, stream: true } }),
      signal,
    });
  } catch {
    enqueueRequest(operation, payload);
    throw new WorkerUnavailableError(true);
  }

  if (!response.ok || !response.body) {
    enqueueRequest(operation, payload);
    throw new WorkerUnavailableError(true);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      let eventType = "message";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          const rawData = line.slice(6).trim();
          if (rawData === "[DONE]") {
            yield { type: "done", data: null };
            return;
          }
          try {
            const parsed = JSON.parse(rawData);
            yield {
              type: eventType as "delta" | "usage" | "error",
              data: parsed,
            };
          } catch {
            /* skip malformed SSE chunk */
          }
          eventType = "message"; // reset after data line
        }
      }
    }
  } finally {
    reader.cancel();
  }
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────

export interface AlignmentRequest {
  session_id: string;
  agent_id: string;
  prompt: string;
  context_window?: string[];
  temperature?: number;
  stream?: boolean;
  idempotency_key?: string;
}

export interface AlignmentResult {
  session_id: string;
  agent_id: string;
  status: "aligned" | "misaligned" | "uncertain";
  score: number;
  reasoning: string;
  recommendations: string[];
  token_usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  latency_ms: number;
  model: string;
  created_at: string;
}

export async function runAlignment(req: AlignmentRequest): Promise<AlignmentResult> {
  return dispatch<AlignmentResult>({
    operation: "alignment",
    payload: req as unknown as Record<string, unknown>,
    idempotencyKey: req.idempotency_key,
  });
}

export interface CompressionRequest {
  session_id: string;
  content: string;
  target_ratio?: number;
  preserve_keys?: string[];
  format?: "summary" | "bullet_points" | "structured_json";
}

export interface CompressionResult {
  session_id: string;
  original_length: number;
  compressed_length: number;
  actual_ratio: number;
  compressed_content: string;
  format: string;
  token_usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  latency_ms: number;
  model: string;
  created_at: string;
}

export async function runCompression(req: CompressionRequest): Promise<CompressionResult> {
  return dispatch<CompressionResult>({
    operation: "compression",
    payload: req as unknown as Record<string, unknown>,
  });
}

export interface EmbedRequest {
  session_id: string;
  texts: string[];
}

export interface EmbedResult {
  session_id: string;
  embeddings: number[][];
  model: string;
  dim: number;
  count: number;
  created_at: string;
}

export async function runEmbed(req: EmbedRequest): Promise<EmbedResult> {
  return dispatch<EmbedResult>({
    operation: "embed",
    payload: req as unknown as Record<string, unknown>,
  });
}

// ─── Health check ─────────────────────────────────────────────────────────────

export async function checkWorkerHealth(): Promise<{
  ok: boolean;
  status: string;
  latency_ms: number;
}> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${WORKER_BASE_URL}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    const body = await res.json() as { status: string };
    return { ok: res.ok, status: body.status ?? "unknown", latency_ms: Date.now() - t0 };
  } catch {
    return { ok: false, status: "unreachable", latency_ms: Date.now() - t0 };
  }
}
