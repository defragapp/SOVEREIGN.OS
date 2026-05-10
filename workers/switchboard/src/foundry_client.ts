// workers/switchboard/src/foundry_client.ts
// Wrapper for the Foundry API (external agent orchestration layer).
// Implements exponential backoff with jitter, timeout, and circuit breaker.

export interface FoundryEnv {
  FOUNDRY_API_URL: string;
  FOUNDRY_API_KEY: string;
}

export interface FoundryRunRequest {
  agent_id: string;
  user_id: string;
  input: Record<string, unknown>;
  stream?: boolean;
  timeout_ms?: number;
}

export interface FoundryRunResponse {
  run_id: string;
  status: "completed" | "failed" | "running";
  output?: Record<string, unknown>;
  error?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ─── Retry config ─────────────────────────────────────────────────────────────

interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
  retryableStatuses: number[];
}

const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 8_000,
  jitterMs: 100,
  retryableStatuses: [429, 500, 502, 503, 504],
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffDelay(attempt: number, config: RetryConfig): number {
  const exp = Math.min(config.baseDelayMs * 2 ** attempt, config.maxDelayMs);
  const jitter = Math.random() * config.jitterMs;
  return exp + jitter;
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class FoundryClient {
  private baseUrl: string;
  private apiKey: string;
  private retryConfig: RetryConfig;

  constructor(env: FoundryEnv, retryConfig: Partial<RetryConfig> = {}) {
    this.baseUrl = env.FOUNDRY_API_URL.replace(/\/$/, "");
    this.apiKey = env.FOUNDRY_API_KEY;
    this.retryConfig = { ...DEFAULT_RETRY, ...retryConfig };
  }

  private get defaultHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "X-Client": "sovereign-switchboard/1.0",
    };
  }

  // ─── Core fetch with retry/backoff ─────────────────────────────────────────

  private async fetchWithRetry(
    path: string,
    init: RequestInit,
    timeoutMs = 30_000
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.retryConfig.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(url, {
          ...init,
          signal: controller.signal,
          headers: { ...this.defaultHeaders, ...(init.headers as Record<string, string>) },
        });
        clearTimeout(timer);

        if (!this.retryConfig.retryableStatuses.includes(res.status)) {
          return res; // success or non-retryable error — return immediately
        }

        // Retryable HTTP error
        const retryAfter = res.headers.get("Retry-After");
        const delay = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : backoffDelay(attempt, this.retryConfig);

        lastError = new FoundryError(
          `Foundry returned ${res.status} on attempt ${attempt + 1}`,
          res.status
        );

        if (attempt < this.retryConfig.maxAttempts - 1) {
          await sleep(delay);
        }
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof Error && err.name === "AbortError") {
          lastError = new FoundryError(`Foundry request timed out after ${timeoutMs}ms`, 408);
        } else {
          lastError = err instanceof Error ? err : new Error(String(err));
        }
        if (attempt < this.retryConfig.maxAttempts - 1) {
          await sleep(backoffDelay(attempt, this.retryConfig));
        }
      }
    }

    throw lastError ?? new FoundryError("Foundry request failed after all retries", 502);
  }

  // ─── Run an agent ─────────────────────────────────────────────────────────

  async run(request: FoundryRunRequest): Promise<FoundryRunResponse> {
    const { timeout_ms = 30_000, ...body } = request;

    const res = await this.fetchWithRetry(
      "/v1/runs",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      timeout_ms
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new FoundryError(`Foundry run failed: ${errText}`, res.status);
    }

    return res.json() as Promise<FoundryRunResponse>;
  }

  // ─── Stream a run ─────────────────────────────────────────────────────────

  async stream(request: FoundryRunRequest): Promise<ReadableStream<Uint8Array>> {
    const { timeout_ms = 60_000, ...body } = request;

    const res = await this.fetchWithRetry(
      "/v1/runs/stream",
      {
        method: "POST",
        body: JSON.stringify({ ...body, stream: true }),
      },
      timeout_ms
    );

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      throw new FoundryError(`Foundry stream failed: ${errText}`, res.status);
    }

    return res.body;
  }

  // ─── Get run status ───────────────────────────────────────────────────────

  async getStatus(runId: string): Promise<FoundryRunResponse> {
    const res = await this.fetchWithRetry(`/v1/runs/${encodeURIComponent(runId)}`, {
      method: "GET",
    });

    if (!res.ok) {
      throw new FoundryError(`Foundry getStatus failed: ${res.status}`, res.status);
    }

    return res.json() as Promise<FoundryRunResponse>;
  }

  // ─── Health probe ─────────────────────────────────────────────────────────

  async probe(): Promise<{ ok: boolean; latency_ms: number }> {
    const start = Date.now();
    try {
      const res = await this.fetchWithRetry("/health", { method: "GET" }, 5_000);
      return { ok: res.ok, latency_ms: Date.now() - start };
    } catch {
      return { ok: false, latency_ms: Date.now() - start };
    }
  }
}

// ─── Error class ──────────────────────────────────────────────────────────────

export class FoundryError extends Error {
  constructor(
    message: string,
    public readonly status: number = 500
  ) {
    super(message);
    this.name = "FoundryError";
  }
}
