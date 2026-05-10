# Worker Security Guide — Sovereign AI Switchboard

> **Audience:** Engineers, security reviewers, and ops team.
> **Last updated:** 2026-05-09

---

## Table of Contents

1. [Threat Model](#threat-model)
2. [CORS Policy](#cors-policy)
3. [Authentication & Authorization](#authentication--authorization)
4. [Rate Limiting](#rate-limiting)
5. [Idempotency](#idempotency)
6. [Request Size Limits](#request-size-limits)
7. [Secrets Management](#secrets-management)
8. [Webhook Security](#webhook-security)
9. [PII Handling](#pii-handling)
10. [Content Security Policy](#content-security-policy)
11. [Dependency Security](#dependency-security)
12. [Incident Response](#incident-response)

---

## Threat Model

| Threat | Mitigation |
|--------|-----------|
| Cross-origin request forgery | CORS allowlist; credentials: include |
| Replay attacks (webhooks) | HMAC-SHA256 + idempotency key deduplication |
| Prompt injection via user input | Input length limits; Zod validation; system prompt anchoring |
| Secret exfiltration | Secrets via `wrangler secret put` only; never in env vars, code, or logs |
| Credit/rate-limit bypass | Server-side rate check against Supabase `agent_runs` |
| Pro-gate bypass | Server-side tier check against `profiles.tier` via service role key |
| Oversized payload attack | 256 KB hard limit on all `/dispatch` requests |
| Streaming resource exhaustion | 55-second SSE timeout; CPU time limit via `wrangler.toml` |
| Supply chain attacks | Lockfile committed; npm audit in CI |

---

## CORS Policy

### Allowed origins

```typescript
const ALLOWED_ORIGINS = [
  "https://sovereign.os",
  "https://www.sovereign.os",
  "https://staging.sovereign.os",
  "http://localhost:3000",
  "http://localhost:3001",
];
```

- Any request from an origin not in this list receives **no** `Access-Control-Allow-Origin` header, causing the browser to block it.
- The `credentials: include` flag is set on all frontend fetch calls, enabling cookie-based session sharing between `sovereign.os` and `api.sovereign.os`.
- Preflight (`OPTIONS`) requests are cached for 86,400 seconds (1 day) to reduce latency.

### Adding a new origin

1. Add the origin to `ALLOWED_ORIGINS` in `workers/switchboard/src/index.ts`
2. Deploy to staging and verify with: `curl -I -X OPTIONS https://api-staging.sovereign.os/dispatch -H "Origin: https://new-origin.com"`
3. Confirm `Access-Control-Allow-Origin: https://new-origin.com` appears in the response headers

---

## Authentication & Authorization

### User identity

The Worker does **not** issue or verify JWT tokens directly. User identity is passed via the `user_id` field in the dispatch envelope. The NextAuth session on the frontend ensures only authenticated users reach the Worker.

**Recommended enhancement:** Add JWT verification middleware to the Worker:

```typescript
// Recommended future addition to index.ts middleware
app.use("/dispatch", async (c, next) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return c.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  // Verify against SUPABASE_JWT_SECRET
  // ...
  return next();
});
```

### Pro tier gate

All requests to `compression` and `covenant` spaces check `profiles.tier = 'pro'` via Supabase PostgREST using the service role key. Downgrades are enforced immediately — no client-side caching of tier status.

### Rate limiting

Server-side only. Rate limits are enforced by counting `agent_runs` rows for the user within the rolling window. Clients cannot override or bypass this.

---

## Rate Limiting

| Space | Window | Max | Tier |
|-------|--------|-----|------|
| Launcher | — | Unlimited | Free |
| Defrag | 24 hours | 3 | Free |
| Alignment | 24 hours | 5 | Free |
| The Loop | 24 hours | 3 | Free |
| Compression | — | Unlimited | Pro |
| Covenant | — | Unlimited | Pro |

- Rate limit state lives in `agent_runs` (Supabase). No KV store or Durable Objects required.
- On rate limit hit: HTTP 429 with `X-RateLimit-Remaining: 0` and a user-friendly message.
- **Fail open:** If the Supabase rate check errors, the request is allowed (avoids blocking legitimate users due to DB latency spikes).

---

## Idempotency

The `/dispatch` route supports an optional `X-Idempotency-Key` header and `idempotency_key` body field.

### Behaviour

1. On first request: execute normally, log to `agent_runs` with the idempotency key.
2. On duplicate request (same `user_id` + `idempotency_key`): return HTTP 200 `{ cached: true }` immediately — no AI call.

### Webhook idempotency

Stripe webhooks include an `idempotency_key` field. The `/webhook` handler processes each event exactly once. Re-sent webhooks return 200 without re-processing.

### Generating idempotency keys (frontend)

```typescript
import { nanoid } from "nanoid";
const key = `alignment-${nanoid()}`;
```

---

## Request Size Limits

| Limit | Value |
|-------|-------|
| Max body size (dispatch) | 256 KB |
| Max content field (compression) | 40,000 characters |
| Max question field (alignment) | 1,200 characters |
| Max entries (defrag) | 50 entries × 4,000 chars each |
| Max message (the_loop) | 8,000 characters |
| Max streaming timeout | 55 seconds |
| Cloudflare CPU limit | 50ms per request (configured in wrangler.toml) |

Oversized requests receive HTTP 413 immediately, before any AI call is made.

---

## Secrets Management

### What is secret

| Secret | Description | Rotation cadence |
|--------|-------------|-----------------|
| `GEMINI_API_KEY` | Google AI Studio API key | 90 days |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin key (bypasses RLS) | 90 days |
| `FOUNDRY_API_KEY` | Foundry agent API key | 90 days |
| `WORKER_HMAC_SECRET` | HMAC key for webhook verification | 90 days or on compromise |
| `SENTRY_DSN` | Error reporting endpoint | On Sentry project change |
| `DATADOG_API_KEY` | Metrics API key | 90 days |

### What is NOT secret (safe to expose)

- `SUPABASE_URL` — PostgREST base URL (public)
- `ENVIRONMENT` — "staging" / "production"
- `NEXT_PUBLIC_WORKER_URL` — public Worker URL

### Secret handling rules

1. Never log secrets — no `console.log(env.GEMINI_API_KEY)`
2. Never echo secrets in responses
3. Never include secrets in error messages
4. Never store secrets in `wrangler.toml` — use `wrangler secret put` only
5. The `.env.example` file at repo root is for documentation only — it contains no real values

---

## Webhook Security

All webhook requests to `/webhook` must include a valid HMAC-SHA256 signature in the `X-Sovereign-Signature` header.

### Signature verification (Worker)

```typescript
// Compute expected signature
const key = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(env.WORKER_HMAC_SECRET),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["verify"]
);
const valid = await crypto.subtle.verify("HMAC", key, sigBytes, bodyBytes);
```

### Signing webhooks (sender side)

```typescript
const sig = await crypto.subtle.sign(
  "HMAC",
  key,
  new TextEncoder().encode(body)
);
const hexSig = Array.from(new Uint8Array(sig))
  .map(b => b.toString(16).padStart(2, "0"))
  .join("");
// Send as: X-Sovereign-Signature: <hexSig>
```

### Stripe webhook integration

Stripe's native signature (`Stripe-Signature`) is **not** used directly. Instead, the Stripe webhook adapter (in the backend service) re-signs the event using `WORKER_HMAC_SECRET` before forwarding to the Worker. This decouples the Worker from Stripe's signature scheme.

---

## PII Handling

### What the Worker stores

| Field | Stored where | Retention |
|-------|-------------|-----------|
| `user_id` | `agent_runs`, `loop_messages` | Follows Supabase retention policy |
| `space`, `model`, `status` | `agent_runs` | Follows Supabase retention policy |
| `content` (loop messages) | `loop_messages` | User-controlled |
| Date of birth | **Not stored** — used only in prompt context, never persisted by Worker |
| AI responses | `loop_messages` only | User-controlled |

### What the Worker never stores

- Raw request payloads (alignment questions, compression content, defrag entries)
- IP addresses
- User agent strings
- Authentication tokens

### Data minimisation principles

1. Alignment readings are returned to the client and not persisted by the Worker.
2. The DOB is included in the AI prompt but never written to any database table.
3. `agent_runs` contains only metadata (space, model, latency, status) — no content.

### GDPR / deletion

When a user deletes their account, the frontend calls the Supabase `profiles` delete endpoint. Cascade deletes via Supabase RLS/triggers should cover `agent_runs` and `loop_messages`. Verify cascade rules in `db/migrations/`.

---

## Content Security Policy

The Worker sets the following security headers on all responses:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
```

The frontend (`next.config.ts`) sets additional headers including a full CSP. The Worker does **not** set a CSP header — that is the frontend's responsibility.

### Recommended CSP for sovereign.os (frontend)

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-{SERVER_NONCE}';
  connect-src 'self' https://api.sovereign.os https://api-staging.sovereign.os
              https://*.supabase.co wss://*.supabase.co;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: blob:;
  frame-ancestors 'none';
  upgrade-insecure-requests;
```

---

## Dependency Security

### Audit

```bash
# Run in workers/switchboard/
npm audit
npm audit --audit-level=high  # CI gate — fail on high+ severity
```

CI runs `npm audit` on every push. High-severity vulnerabilities block the deploy.

### Lockfile

`package-lock.json` is committed for reproducible installs. Do not run `npm install` without committing the updated lockfile.

### Supply chain

- All dependencies are pinned to exact versions in `package.json`
- Hono, the AI SDK, and Zod are all audited, actively maintained packages
- `@cloudflare/workers-types` is a dev-only type package — not bundled

---

## Incident Response

### Suspected key compromise

1. **Immediately** rotate the affected secret (`wrangler secret put <KEY> --env production`)
2. Check Cloudflare Workers logs for abnormal usage in the past 24h
3. Check Supabase `agent_runs` for unexpected user_ids or high-volume calls
4. Revoke the old key at the provider (Google AI Studio, Supabase, Foundry)
5. Post incident report to Slack `#security-incidents`

### Worker returning 5xx in production

1. Check `/health` endpoint for degraded subsystem
2. Check Cloudflare Workers analytics for error rate spike
3. Check Supabase status page (status.supabase.com)
4. Check Google AI status (status.cloud.google.com)
5. If Gemini is down: Worker will return 500 — frontend shows "try again" message automatically
6. If Supabase is down: rate limits and auth fail open; AI calls still work

### Rollback procedure

See [worker-deploy.md → Rollback](./worker-deploy.md#rollback) for step-by-step instructions.

### Contact

| Role | Channel |
|------|---------|
| On-call engineer | PagerDuty rotation |
| Security incidents | `#security-incidents` Slack |
| Cloudflare support | dashboard.cloudflare.com/support |
| Supabase support | supabase.com/support |
