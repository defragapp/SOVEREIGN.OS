/**
 * supabase_client.ts
 * PostgREST wrapper for Supabase — uses HTTPS fetch only (no TCP / pg driver).
 * All writes go through the service-role key; reads may use the anon key.
 */

// ─── Config ───────────────────────────────────────────────────────────────────

export interface SupabaseConfig {
  url: string;
  serviceRoleKey: string;
  anonKey?: string;
  /** Retry up to this many times on 5xx / network error */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff */
  baseDelayMs?: number;
}

// ─── Internal fetch with retry ────────────────────────────────────────────────

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3,
  baseDelayMs = 250
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 50;
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      const response = await fetch(url, init);
      // Retry only on 5xx
      if (response.status >= 500 && attempt < maxRetries) {
        lastError = new Error(`Supabase returned ${response.status}`);
        continue;
      }
      return response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === maxRetries) break;
    }
  }

  throw lastError ?? new Error("Unknown Supabase fetch error");
}

// ─── Client class ─────────────────────────────────────────────────────────────

export class SupabaseClient {
  private readonly restBase: string;
  private readonly serviceRoleKey: string;
  private readonly anonKey: string;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;

  constructor(cfg: SupabaseConfig) {
    // Normalise trailing slash
    const base = cfg.url.replace(/\/$/, "");
    this.restBase = `${base}/rest/v1`;
    this.serviceRoleKey = cfg.serviceRoleKey;
    this.anonKey = cfg.anonKey ?? cfg.serviceRoleKey;
    this.maxRetries = cfg.maxRetries ?? 3;
    this.baseDelayMs = cfg.baseDelayMs ?? 250;
  }

  // ─── Headers ─────────────────────────────────────────────────────────────

  private headers(useServiceRole = true): Record<string, string> {
    const key = useServiceRole ? this.serviceRoleKey : this.anonKey;
    return {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
  }

  // ─── SELECT ───────────────────────────────────────────────────────────────

  async select<T = Record<string, unknown>>(
    table: string,
    params: Record<string, string> = {},
    useServiceRole = false
  ): Promise<T[]> {
    const qs = new URLSearchParams(params).toString();
    const url = `${this.restBase}/${table}${qs ? `?${qs}` : ""}`;

    const response = await fetchWithRetry(
      url,
      { method: "GET", headers: this.headers(useServiceRole) },
      this.maxRetries,
      this.baseDelayMs
    );

    if (!response.ok) {
      const body = await response.text();
      throw new SupabaseError(`SELECT ${table} failed: ${response.status}`, response.status, body);
    }

    return response.json() as Promise<T[]>;
  }

  // ─── INSERT ───────────────────────────────────────────────────────────────

  async insert<T = Record<string, unknown>>(
    table: string,
    data: Record<string, unknown> | Record<string, unknown>[],
    options: { onConflict?: string; ignoreDuplicates?: boolean } = {}
  ): Promise<T[]> {
    const prefer = options.ignoreDuplicates
      ? "return=representation,resolution=ignore-duplicates"
      : `return=representation${options.onConflict ? `,resolution=merge-duplicates` : ""}`;

    const headers = {
      ...this.headers(true),
      Prefer: prefer,
    };

    if (options.onConflict) {
      (headers as Record<string, string>)["on-conflict"] = options.onConflict;
    }

    const response = await fetchWithRetry(
      `${this.restBase}/${table}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(data),
      },
      this.maxRetries,
      this.baseDelayMs
    );

    if (!response.ok) {
      const body = await response.text();
      throw new SupabaseError(`INSERT ${table} failed: ${response.status}`, response.status, body);
    }

    return response.json() as Promise<T[]>;
  }

  // ─── UPSERT ───────────────────────────────────────────────────────────────

  async upsert<T = Record<string, unknown>>(
    table: string,
    data: Record<string, unknown> | Record<string, unknown>[],
    onConflict: string
  ): Promise<T[]> {
    const response = await fetchWithRetry(
      `${this.restBase}/${table}`,
      {
        method: "POST",
        headers: {
          ...this.headers(true),
          Prefer: "return=representation,resolution=merge-duplicates",
          "on-conflict": onConflict,
        },
        body: JSON.stringify(data),
      },
      this.maxRetries,
      this.baseDelayMs
    );

    if (!response.ok) {
      const body = await response.text();
      throw new SupabaseError(`UPSERT ${table} failed: ${response.status}`, response.status, body);
    }

    return response.json() as Promise<T[]>;
  }

  // ─── UPDATE ───────────────────────────────────────────────────────────────

  async update<T = Record<string, unknown>>(
    table: string,
    filter: Record<string, string>,
    data: Record<string, unknown>
  ): Promise<T[]> {
    const qs = new URLSearchParams(filter).toString();
    const url = `${this.restBase}/${table}?${qs}`;

    const response = await fetchWithRetry(
      url,
      {
        method: "PATCH",
        headers: this.headers(true),
        body: JSON.stringify(data),
      },
      this.maxRetries,
      this.baseDelayMs
    );

    if (!response.ok) {
      const body = await response.text();
      throw new SupabaseError(`UPDATE ${table} failed: ${response.status}`, response.status, body);
    }

    return response.json() as Promise<T[]>;
  }

  // ─── RPC ──────────────────────────────────────────────────────────────────

  async rpc<T = unknown>(
    fn: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    const response = await fetchWithRetry(
      `${this.restBase}/rpc/${fn}`,
      {
        method: "POST",
        headers: this.headers(true),
        body: JSON.stringify(params),
      },
      this.maxRetries,
      this.baseDelayMs
    );

    if (!response.ok) {
      const body = await response.text();
      throw new SupabaseError(`RPC ${fn} failed: ${response.status}`, response.status, body);
    }

    return response.json() as Promise<T>;
  }

  // ─── Connectivity probe ───────────────────────────────────────────────────

  async probe(): Promise<{ ok: boolean; latency_ms: number }> {
    const t0 = Date.now();
    try {
      // Lightweight HEAD request to the REST root — no data transferred
      const response = await fetch(`${this.restBase}/`, {
        method: "HEAD",
        headers: this.headers(false),
      });
      return { ok: response.ok, latency_ms: Date.now() - t0 };
    } catch {
      return { ok: false, latency_ms: Date.now() - t0 };
    }
  }
}

// ─── Domain-specific helpers ──────────────────────────────────────────────────

/** Insert an agent_run record and return the created row. */
export async function insertAgentRun(
  db: SupabaseClient,
  run: {
    id: string;
    agent_id: string;
    session_id: string;
    operation: string;
    status: "pending" | "running" | "completed" | "failed";
    input_summary?: string;
    created_at: string;
  }
) {
  return db.insert("agent_runs", run, { onConflict: "id" });
}

/** Update agent_run status and output. */
export async function completeAgentRun(
  db: SupabaseClient,
  runId: string,
  result: {
    status: "completed" | "failed";
    output_summary?: string;
    error_message?: string;
    token_usage?: Record<string, number>;
    completed_at: string;
  }
) {
  return db.update("agent_runs", { "id=eq": runId }, result);
}

/** Insert a loop_message record. */
export async function insertLoopMessage(
  db: SupabaseClient,
  message: {
    id: string;
    loop_id: string;
    session_id: string;
    role: string;
    content: string;
    embedding?: number[];
    created_at: string;
  }
) {
  return db.insert("loop_messages", message);
}

/** Upsert a baseline_design record. */
export async function upsertBaselineDesign(
  db: SupabaseClient,
  design: {
    id: string;
    agent_id: string;
    name: string;
    spec: Record<string, unknown>;
    embedding?: number[];
    updated_at: string;
  }
) {
  return db.upsert("baseline_designs", design, "id");
}

// ─── Error class ──────────────────────────────────────────────────────────────

export class SupabaseError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string
  ) {
    super(message);
    this.name = "SupabaseError";
  }

  get retryable(): boolean {
    return this.status >= 500;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createSupabaseClient(env: {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}): SupabaseClient {
  return new SupabaseClient({
    url: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  });
}
