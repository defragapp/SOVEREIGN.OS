/**
 * foundry_client.ts
 * Wrapper for Foundry API calls with exponential backoff and circuit-breaker.
 * All requests are authenticated with FOUNDRY_API_KEY via Bearer token.
 */

// ─── Config ───────────────────────────────────────────────────────────────────

export interface FoundryConfig {
  baseUrl: string;
  apiKey: string;
  /** Request timeout in ms (default 30 s) */
  timeoutMs?: number;
  /** Max retry attempts on 5xx/network errors */
  maxRetries?: number;
  /** Initial backoff delay in ms */
  baseDelayMs?: number;
}

// ─── Circuit breaker state (module-level, shared per isolate lifetime) ────────

interface CircuitState {
  failures: number;
  lastFailureAt: number;
  open: boolean;
}

const circuit: CircuitState = {
  failures: 0,
  lastFailureAt: 0,
  open: false,
};

const CIRCUIT_THRESHOLD = 5; // trips after N consecutive failures
const CIRCUIT_RESET_MS = 30_000; // half-open after 30 s

function isCircuitOpen(): boolean {
  if (!circuit.open) return false;
  if (Date.now() - circuit.lastFailureAt > CIRCUIT_RESET_MS) {
    // Allow one probe through (half-open)
    circuit.open = false;
    return false;
  }
  return true;
}

function recordSuccess() {
  circuit.failures = 0;
  circuit.open = false;
}

function recordFailure() {
  circuit.failures += 1;
  circuit.lastFailureAt = Date.now();
  if (circuit.failures >= CIRCUIT_THRESHOLD) {
    circuit.open = true;
  }
}

// ─── Core fetch with retry ────────────────────────────────────────────────────

async function foundryFetch(
  url: string,
  init: RequestInit,
  maxRetries: number,
  baseDelayMs: number,
  timeoutMs: number
): Promise<Response> {
  if (isCircuitOpen()) {
    throw new FoundryError("Foundry circuit breaker open — skipping request", 503, true);
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const jitter = Math.random() * 50;
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter;
      await new Promise((r) => setTimeout(r, delay));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (response.status >= 500 && attempt < maxRetries) {
        recordFailure();
        lastError = new Error(`Foundry returned ${response.status}`);
        continue;
      }

      recordSuccess();
      return response;
    } catch (err) {
      clearTimeout(timer);
      recordFailure();
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === maxRetries) break;
    }
  }

  throw lastError ?? new Error("Unknown Foundry fetch error");
}

// ─── Client class ─────────────────────────────────────────────────────────────

export class FoundryClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;

  constructor(cfg: FoundryConfig) {
    this.baseUrl = cfg.baseUrl.replace(/\/$/, "");
    this.apiKey = cfg.apiKey;
    this.timeoutMs = cfg.timeoutMs ?? 30_000;
    this.maxRetries = cfg.maxRetries ?? 3;
    this.baseDelayMs = cfg.baseDelayMs ?? 300;
  }

  private get defaultHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  // ─── GET ──────────────────────────────────────────────────────────────────

  async get<T = unknown>(path: string, params: Record<string, string> = {}): Promise<T> {
    const qs = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}${path}${qs ? `?${qs}` : ""}`;

    const response = await foundryFetch(
      url,
      { method: "GET", headers: this.defaultHeaders },
      this.maxRetries,
      this.baseDelayMs,
      this.timeoutMs
    );

    if (!response.ok) {
      const body = await response.text();
      throw new FoundryError(
        `Foundry GET ${path} failed: ${response.status}`,
        response.status,
        response.status >= 500
      );
    }

    return response.json() as Promise<T>;
  }

  // ─── POST ─────────────────────────────────────────────────────────────────

  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    const response = await foundryFetch(
      `${this.baseUrl}${path}`,
      {
        method: "POST",
        headers: this.defaultHeaders,
        body: JSON.stringify(body),
      },
      this.maxRetries,
      this.baseDelayMs,
      this.timeoutMs
    );

    if (!response.ok) {
      const errBody = await response.text();
      throw new FoundryError(
        `Foundry POST ${path} failed: ${response.status}`,
        response.status,
        response.status >= 500
      );
    }

    return response.json() as Promise<T>;
  }

  // ─── Domain operations ────────────────────────────────────────────────────

  /** Fetch an agent manifest from Foundry. */
  async getAgentManifest(agentId: string): Promise<Record<string, unknown>> {
    return this.get(`/v1/agents/${agentId}/manifest`);
  }

  /** Submit an agent evaluation result to Foundry. */
  async submitEvaluation(agentId: string, result: Record<string, unknown>): Promise<void> {
    await this.post(`/v1/agents/${agentId}/evaluations`, result);
  }

  /** Fetch Foundry model catalog. */
  async listModels(): Promise<{ models: Array<{ id: string; name: string }> }> {
    return this.get("/v1/models");
  }

  /** Health probe — lightweight ping to Foundry API. */
  async probe(): Promise<{ ok: boolean; latency_ms: number }> {
    const t0 = Date.now();
    try {
      await this.get("/v1/health");
      return { ok: true, latency_ms: Date.now() - t0 };
    } catch {
      return { ok: false, latency_ms: Date.now() - t0 };
    }
  }
}

// ─── Error class ──────────────────────────────────────────────────────────────

export class FoundryError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "FoundryError";
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createFoundryClient(env: {
  FOUNDRY_API_URL: string;
  FOUNDRY_API_KEY: string;
}): FoundryClient {
  return new FoundryClient({
    baseUrl: env.FOUNDRY_API_URL,
    apiKey: env.FOUNDRY_API_KEY,
  });
}
