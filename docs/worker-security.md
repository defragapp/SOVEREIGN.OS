# Sovereign AI Switchboard — Security & Operations Guide

> **Last updated:** 2026-05-09  
> **Worker:** `sovereign-switchboard` · `api.sovereign.os`

---

## 1. Content Security Policy (CSP)

The Worker is a JSON/SSE API — it does not serve HTML. CSP headers are not required for the Worker itself. However, the **frontend** that calls the Worker must include:

```http
Content-Security-Policy:
  default-src 'self';
  connect-src 'self' https://api.sovereign.os https://api-staging.sovereign.os;
  script-src 'self' 'nonce-{NONCE}';
  style-src 'self' 'nonce-{NONCE}';
  img-src 'self' data: https:;
  frame-ancestors 'none';
  form-action 'self';
  upgrade-insecure-requests;
```

The Worker sets the following security headers on every response via Hono's `secureHeaders()` middleware:

| Header | Value |
|--------|-------|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=()` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` |

---

## 2. CORS Policy

The Worker enforces a strict allowlist of origins. The allowlist is defined in `workers/switchboard/src/index.ts`:

```typescript
const ALLOWED_ORIGINS = [
  "https://sovereign.os",
  "https://www.sovereign.os",
  "https://app.sovereign.os",
  /^https:\/\/sovereign.*\.vercel\.app$/,   // Vercel preview URLs
];
```

**Rules:**
- Requests from non-listed origins receive an empty `Access-Control-Allow-Origin` header.
- Preflight `OPTIONS` requests return `204 No Content` within ~1 ms (no AI calls made).
- Credentials (`withCredentials`) are **not** supported — the Worker uses API key authentication at the edge, not cookies.
- To add a new origin: update `ALLOWED_ORIGINS` and deploy. No secrets change needed.

**Never add wildcard `*` to the production allowlist.**

---

## 3. Rate Limiting

### 3.1 Cloudflare-level rate limiting (recommended)

Configure in the Cloudflare dashboard under **Security → WAF → Rate Limiting Rules**:

| Rule | Path | Limit | Period | Action |
|------|------|-------|--------|--------|
| Dispatch global | `/dispatch` | 100 req | 60 s per IP | Block (429) |
| Dispatch per session | `/dispatch` | 20 req | 60 s per header `X-Session-Id` | Block (429) |
| Webhook | `/webhook` | 500 req | 60 s per IP | Block (429) |
| Health probe | `/health` | 60 req | 60 s per IP | Block (429) |

### 3.2 Application-level request size limits

Enforced in `stream_helpers.ts → readBodyWithLimit()`:

| Endpoint | Max body size |
|----------|--------------|
| `/dispatch` (alignment, compression) | 512 KB |
| `/dispatch` (simulator) | 512 KB |
| `/dispatch` (embed) | 256 KB |
| `/webhook` | 128 KB |

### 3.3 Streaming timeouts

Enforced in `stream_helpers.ts → withStreamTimeout()`:

| Stream type | Timeout |
|-------------|---------|
| Alignment stream | 25 s |
| Simulator stream | 25 s |

Cloudflare Workers have a hard 30 s CPU time limit on the Paid plan. The 25 s application timeout provides a 5 s safety margin for cleanup.

---

## 4. Idempotency

### 4.1 `/dispatch`

- Clients SHOULD send an `X-Idempotency-Key` header (UUID or nanoid).
- If the same key is received twice within 60 seconds, the Worker returns the cached response (if implemented via Cloudflare KV — not yet wired).
- Current implementation: idempotency keys are persisted to `webhook_events.idempotency_key` in Supabase with `ON CONFLICT DO NOTHING`.

### 4.2 `/webhook`

- Every webhook payload MUST include `idempotency_key`.
- The Worker inserts the key into `webhook_events` with `ON CONFLICT (idempotency_key) DO NOTHING`.
- Duplicate events are silently accepted (HTTP 200) without re-processing.
- Keys are never deleted — this guarantees exactly-once semantics for the lifetime of the project.

**Implementation checklist for new webhook handlers:**
1. ✅ Extract `idempotency_key` from payload.
2. ✅ Attempt INSERT with `ignoreDuplicates: true`.
3. ✅ Check INSERT result — if 0 rows inserted, the event is a duplicate; return 200 without processing.
4. ✅ Process event.
5. ✅ Return 200.

---

## 5. PII Handling

### 5.1 Data classification

| Field | Classification | Notes |
|-------|---------------|-------|
| `session_id` | Pseudonymous identifier | UUID — not directly linkable to a user |
| `agent_id` | System identifier | Not PII |
| `prompt` content | Potentially sensitive | May contain user data; treat as confidential |
| `compressed_content` | Potentially sensitive | Same as prompt |
| Loop messages | Potentially sensitive | Stored in `loop_messages`; encrypted at rest via Supabase |
| Embeddings | Derived / non-reversible | 768-dim vectors — not directly PII |
| IP addresses | PII in some jurisdictions | Cloudflare logs IPs; configure log retention per GDPR/CCPA |

### 5.2 Data minimisation rules

- The Worker **never logs** prompt content, compressed content, or message bodies.
- The Worker logs: `operation`, `session_id`, `agent_id`, `status`, `latency_ms`, `token_usage`.
- `input_summary` and `output_summary` stored in `agent_runs` are limited to 256 characters.
- PII in prompts must be redacted by the caller before sending to the Worker.

### 5.3 Data retention

| Table | Retention | Cleanup |
|-------|-----------|---------|
| `agent_runs` | 90 days | Supabase scheduled deletion job |
| `loop_messages` | 30 days | Supabase scheduled deletion job |
| `webhook_events` | 365 days (idempotency) | Manual archival |
| `baseline_designs` | Indefinite (versioned) | Manual |

### 5.4 Cross-border data transfer

- Google Gemini API: data processed in Google infrastructure. Review Google's data processing addendum for GDPR compliance.
- Cloudflare Workers: edge compute. Enable **Regional Services** in the Cloudflare dashboard to restrict processing to specific regions if required.
- Supabase: ensure the project region matches your data residency requirements.

---

## 6. Authentication & Authorisation

### 6.1 Worker-to-Supabase

- Uses `SUPABASE_SERVICE_ROLE_KEY` for all DB writes.
- The service role key bypasses Row-Level Security (RLS) — **do not expose this key to the frontend**.
- For read-heavy paths where RLS is acceptable, use `anonKey` (passed as `useServiceRole: false` in `supabase_client.ts`).

### 6.2 Worker-to-Foundry

- Uses `FOUNDRY_API_KEY` via `Authorization: Bearer` header.
- Circuit breaker trips after 5 consecutive failures; resets after 30 s.

### 6.3 Webhook signature verification

- Webhooks from trusted senders must include `X-Sovereign-Signature: sha256=<hmac>`.
- The HMAC is computed over the raw request body using `WEBHOOK_SECRET` as the key (SHA-256).
- Verification is performed using `crypto.subtle.verify` (constant-time) to prevent timing attacks.
- Unsigned webhooks are still accepted if `WEBHOOK_SECRET` is not set (development mode). **Always set `WEBHOOK_SECRET` in production.**

### 6.4 Frontend authentication

- The frontend uses Supabase Auth (JWTs) for user authentication.
- The Worker does not validate user JWTs — it trusts the frontend to gate access.
- For multi-tenant isolation, pass `session_id` as a stable per-user/per-session UUID. Never use user IDs directly as session IDs.

---

## 7. Secrets Management

### 7.1 Where secrets live

| Secret | Storage | Access |
|--------|---------|--------|
| `GEMINI_API_KEY` | Cloudflare Workers Secrets | Worker runtime only |
| `SUPABASE_*` | Cloudflare Workers Secrets | Worker runtime only |
| `FOUNDRY_*` | Cloudflare Workers Secrets | Worker runtime only |
| `WEBHOOK_SECRET` | Cloudflare Workers Secrets | Worker runtime only |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions Secrets | CI/CD only |

### 7.2 What is never stored in the repository

- No `.env` files with real values.
- No `wrangler.toml` `[vars]` with secret values.
- No hardcoded API keys anywhere in source code.
- `workers/switchboard/.dev.vars` is gitignored.

### 7.3 Secret scanning

Configure GitHub Secret Scanning (free for public repos, available on Enterprise):
- **Settings → Code security → Secret scanning → Enable**.
- Add a custom pattern for `SUPABASE_SERVICE_ROLE_KEY` format: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`.

---

## 8. Dependency Security

```bash
# Audit dependencies in the Worker
cd workers/switchboard && npm audit

# Pin exact versions in package.json (already done for production dependencies)
# Use `npm ci` in CI — never `npm install`

# Update dependencies monthly
npm outdated
npm update
```

Enable **Dependabot** for the repository:
- `.github/dependabot.yml` with `npm` ecosystem, weekly schedule, targeting `workers/switchboard/`.

---

## 9. Observability & Alerting

### 9.1 Cloudflare Observability

In `wrangler.toml`:
```toml
[observability]
enabled = true
head_sampling_rate = 1  # 100% in staging; set to 0.1 in production
```

Access in Cloudflare dashboard → **Workers & Pages → sovereign-switchboard-production → Observability**.

### 9.2 Sentry integration (optional)

If `SENTRY_DSN` is set, add to `index.ts`:

```typescript
import * as Sentry from "@sentry/cloudflare";

export default Sentry.withSentry(
  (env: Env) => ({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    environment: env.ENVIRONMENT,
  }),
  app
);
```

Install: `npm install @sentry/cloudflare`

### 9.3 Datadog integration (optional)

Use the `DATADOG_API_KEY` secret to emit custom metrics via the Datadog HTTP API from the Worker:

```typescript
async function emitMetric(apiKey: string, metric: string, value: number, tags: string[]) {
  await fetch("https://api.datadoghq.com/api/v2/series", {
    method: "POST",
    headers: { "DD-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      series: [{ metric, type: 1, points: [{ timestamp: Math.floor(Date.now() / 1000), value }], tags }],
    }),
  });
}
```

### 9.4 Key metrics to alert on

| Metric | Threshold | Action |
|--------|-----------|--------|
| `/health` returns 503 | Any occurrence | Page on-call |
| Error rate | > 5% over 5 min | Alert |
| P99 latency | > 10 s | Alert |
| Token usage / day | > 80% of quota | Warn |
| Circuit breaker open | Any occurrence | Alert |
