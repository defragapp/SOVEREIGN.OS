// workers/switchboard/src/supabase_client.ts
// PostgREST wrapper for Supabase — no direct TCP, HTTPS only (edge-safe).
// All operations use the service role key for server-side trust.

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

interface QueryOptions {
  select?: string;
  filters?: Record<string, string | number | boolean | null>;
  limit?: number;
  offset?: number;
  order?: string; // e.g. "created_at.desc"
  single?: boolean; // expect exactly one row
  returning?: "minimal" | "representation";
}

interface MutationOptions {
  onConflict?: string; // column name for upsert
  returning?: "minimal" | "representation";
  count?: "exact" | "planned" | "estimated";
}

export class SupabaseClient {
  private baseUrl: string;
  private serviceKey: string;

  constructor(env: Env) {
    this.baseUrl = env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1";
    this.serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  }

  private get headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      apikey: this.serviceKey,
      Authorization: `Bearer ${this.serviceKey}`,
      "X-Client-Info": "sovereign-switchboard/1.0",
    };
  }

  private buildUrl(table: string, opts: QueryOptions = {}): string {
    const url = new URL(`${this.baseUrl}/${table}`);

    if (opts.select) url.searchParams.set("select", opts.select);
    if (opts.limit !== undefined) url.searchParams.set("limit", String(opts.limit));
    if (opts.offset !== undefined) url.searchParams.set("offset", String(opts.offset));
    if (opts.order) url.searchParams.set("order", opts.order);

    for (const [key, value] of Object.entries(opts.filters ?? {})) {
      if (value === null) {
        url.searchParams.set(key, "is.null");
      } else if (typeof value === "boolean") {
        url.searchParams.set(key, `is.${value}`);
      } else {
        url.searchParams.set(key, `eq.${value}`);
      }
    }

    return url.toString();
  }

  private async request<T>(
    method: HttpMethod,
    url: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: { ...this.headers, ...extraHeaders },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "(no body)");
      throw new SupabaseError(
        `PostgREST ${method} ${url} → ${res.status}: ${errText}`,
        res.status,
        errText
      );
    }

    const text = await res.text();
    if (!text) return undefined as unknown as T;
    return JSON.parse(text) as T;
  }

  // ─── Read ──────────────────────────────────────────────────────────────────

  async select<T = Record<string, unknown>>(
    table: string,
    opts: QueryOptions = {}
  ): Promise<T[]> {
    const url = this.buildUrl(table, opts);
    const extraHeaders: Record<string, string> = {};
    if (opts.single) extraHeaders["Accept"] = "application/vnd.pgrst.object+json";
    return this.request<T[]>("GET", url, undefined, extraHeaders);
  }

  async selectOne<T = Record<string, unknown>>(
    table: string,
    opts: QueryOptions = {}
  ): Promise<T | null> {
    try {
      const row = await this.request<T>(
        "GET",
        this.buildUrl(table, opts),
        undefined,
        { Accept: "application/vnd.pgrst.object+json" }
      );
      return row;
    } catch (e) {
      if (e instanceof SupabaseError && e.status === 406) return null; // no rows
      throw e;
    }
  }

  // ─── Write ─────────────────────────────────────────────────────────────────

  async insert<T = Record<string, unknown>>(
    table: string,
    data: Record<string, unknown> | Record<string, unknown>[],
    opts: MutationOptions = {}
  ): Promise<T[]> {
    const url = new URL(`${this.baseUrl}/${table}`);
    const headers: Record<string, string> = {};

    if (opts.returning === "representation") {
      headers["Prefer"] = "return=representation";
    } else {
      headers["Prefer"] = "return=minimal";
    }
    if (opts.count) headers["Prefer"] += `,count=${opts.count}`;

    return this.request<T[]>("POST", url.toString(), data, headers);
  }

  async upsert<T = Record<string, unknown>>(
    table: string,
    data: Record<string, unknown> | Record<string, unknown>[],
    opts: MutationOptions & { onConflict: string }
  ): Promise<T[]> {
    const url = new URL(`${this.baseUrl}/${table}`);
    url.searchParams.set("on_conflict", opts.onConflict);

    const prefer =
      opts.returning === "representation" ? "return=representation" : "return=minimal";
    return this.request<T[]>(
      "POST",
      url.toString(),
      data,
      { Prefer: `resolution=merge-duplicates,${prefer}` }
    );
  }

  async update<T = Record<string, unknown>>(
    table: string,
    data: Record<string, unknown>,
    filters: Record<string, string | number | boolean | null>,
    opts: MutationOptions = {}
  ): Promise<T[]> {
    const url = this.buildUrl(table, { filters });
    const prefer =
      opts.returning === "representation" ? "return=representation" : "return=minimal";
    return this.request<T[]>("PATCH", url, data, { Prefer: prefer });
  }

  async delete(
    table: string,
    filters: Record<string, string | number | boolean | null>
  ): Promise<void> {
    const url = this.buildUrl(table, { filters });
    await this.request("DELETE", url);
  }

  // ─── Credits ledger helpers ────────────────────────────────────────────────

  async consumeCredit(userId: string, space: string): Promise<boolean> {
    // RPC via PostgREST /rpc
    const url = `${this.baseUrl.replace("/rest/v1", "")}/rest/v1/rpc/consume_credit`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ p_user_id: userId, p_space: space }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { allowed: boolean };
    return data.allowed ?? false;
  }

  // ─── Rate limit check ──────────────────────────────────────────────────────

  async checkRateLimit(
    userId: string,
    space: string,
    windowHours: number,
    maxRequests: number
  ): Promise<{ allowed: boolean; remaining: number }> {
    const since = new Date(Date.now() - windowHours * 3600_000).toISOString();
    const url = this.buildUrl("agent_runs", {
      filters: { user_id: userId, space },
      select: "id",
    });
    // add created_at filter manually
    const urlObj = new URL(url);
    urlObj.searchParams.set("created_at", `gte.${since}`);
    urlObj.searchParams.set("select", "id");
    urlObj.searchParams.set("limit", "999");

    try {
      const rows = await this.request<unknown[]>("GET", urlObj.toString());
      const count = rows?.length ?? 0;
      return { allowed: count < maxRequests, remaining: Math.max(0, maxRequests - count) };
    } catch {
      // fail open — never block on DB error
      return { allowed: true, remaining: maxRequests };
    }
  }

  // ─── Convenience: log agent run ───────────────────────────────────────────

  async logRun(run: {
    user_id: string;
    space: string;
    model: string;
    input_tokens?: number;
    output_tokens?: number;
    latency_ms?: number;
    status: "success" | "error" | "rate_limited";
    error?: string;
    idempotency_key?: string;
  }): Promise<void> {
    await this.insert("agent_runs", {
      ...run,
      created_at: new Date().toISOString(),
    }).catch(() => {
      // logging must never throw
    });
  }
}

export class SupabaseError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string
  ) {
    super(message);
    this.name = "SupabaseError";
  }
}
