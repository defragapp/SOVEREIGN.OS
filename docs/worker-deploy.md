# Worker Deploy Guide — Sovereign AI Switchboard

> **Audience:** Engineers deploying or operating `sovereign-switchboard` (Cloudflare Worker).
> **Last updated:** 2026-05-09

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [First-Time Setup](#first-time-setup)
3. [Secrets Management](#secrets-management)
4. [Local Development](#local-development)
5. [Deploy to Staging](#deploy-to-staging)
6. [Deploy to Production](#deploy-to-production)
7. [Rollback](#rollback)
8. [Secret Rotation](#secret-rotation)
9. [Health Checks](#health-checks)
10. [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 20.x | `nvm install 20` |
| wrangler | ≥ 3.80 | `npm i -g wrangler` |
| CF account | Any plan | dashboard.cloudflare.com |

Ensure you have access to:
- Cloudflare account with Workers & Pages enabled
- `CF_API_TOKEN` with **Edit Workers** permission
- `CF_ACCOUNT_ID` (found in CF dashboard → right sidebar)
- GitHub Environments: `staging`, `production-gate`, `production`

---

## First-Time Setup

```bash
# 1. Clone and navigate to the monorepo
git clone git@github.com:your-org/sovereign-os.git
cd sovereign-os

# 2. Install Worker dependencies
cd workers/switchboard
npm install

# 3. Authenticate wrangler
wrangler login

# 4. Verify authentication
wrangler whoami

# 5. Set all secrets (see Secrets Management below)

# 6. Deploy to staging
npm run deploy:staging
```

---

## Secrets Management

**NEVER** commit secrets to the repository. All Worker secrets are injected via `wrangler secret put`. The `.env.example` file at the repo root is for reference only.

### Set secrets — Staging

```bash
wrangler secret put GEMINI_API_KEY --env staging
wrangler secret put SUPABASE_URL --env staging
wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env staging
wrangler secret put FOUNDRY_API_URL --env staging
wrangler secret put FOUNDRY_API_KEY --env staging
wrangler secret put WORKER_HMAC_SECRET --env staging
wrangler secret put SENTRY_DSN --env staging          # optional
wrangler secret put DATADOG_API_KEY --env staging     # optional
```

### Set secrets — Production

```bash
wrangler secret put GEMINI_API_KEY --env production
wrangler secret put SUPABASE_URL --env production
wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env production
wrangler secret put FOUNDRY_API_URL --env production
wrangler secret put FOUNDRY_API_KEY --env production
wrangler secret put WORKER_HMAC_SECRET --env production
wrangler secret put SENTRY_DSN --env production
wrangler secret put DATADOG_API_KEY --env production
```

### List / verify secrets

```bash
wrangler secret list --env staging
wrangler secret list --env production
```

### Generate WORKER_HMAC_SECRET

```bash
# Generate a cryptographically secure 32-byte secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### GitHub Actions secrets required

| Secret | Used by |
|--------|---------|
| `CF_API_TOKEN` | wrangler deploy |
| `CF_ACCOUNT_ID` | wrangler deploy |
| `STAGING_SUPABASE_URL` | smoke tests |
| `STAGING_SUPABASE_ANON_KEY` | smoke tests |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | supabase-verify |
| `STAGING_GEMINI_API_KEY` | smoke tests |
| `STAGING_TEST_USER_ID` | smoke tests |
| `SLACK_WEBHOOK_URL` | notifications |
| `SENTRY_AUTH_TOKEN` | Sentry release |
| `SENTRY_ORG` | Sentry release |

---

## Local Development

Run both the Worker and the Next.js frontend simultaneously:

```bash
# Terminal 1 — Worker (Miniflare / wrangler dev)
cd workers/switchboard
cp ../../.env.example .dev.vars   # create local secrets file
# Edit .dev.vars — add your real keys (never commit this file)
npx wrangler dev --env staging

# Terminal 2 — Next.js frontend
cd frontend
npm run dev
```

The frontend dev proxy (`next.config.ts`) rewrites `/api/worker/*` → `http://localhost:8787/*` automatically. No frontend changes needed for local development.

### .dev.vars format

```env
GEMINI_API_KEY=your-key-here
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
FOUNDRY_API_URL=https://your-foundry-instance.com
FOUNDRY_API_KEY=your-foundry-key
WORKER_HMAC_SECRET=your-32-byte-hex-secret
ENVIRONMENT=development
```

> **Note:** `.dev.vars` is gitignored. Verify with `git check-ignore -v .dev.vars`.

---

## Deploy to Staging

### Via CI (recommended)

Push to `main` branch — the `worker-deploy.yml` workflow triggers automatically.

### Manual deploy

```bash
cd workers/switchboard
npm run deploy:staging

# Or via the blue/green script:
cd ../..
CF_API_TOKEN=<token> CF_ACCOUNT_ID=<id> bash deploy/bluegreen_deploy.sh staging
```

### Verify staging

```bash
WORKER_URL=https://api-staging.sovereign.os \
TEST_USER_ID=<uuid> \
node scripts/smoke-test.mjs
```

---

## Deploy to Production

Production requires:
1. Staging smoke tests passing (automatic in CI)
2. Manual approval in the `production-gate` GitHub Environment

### Via CI (recommended)

1. Staging deploy succeeds
2. Smoke tests pass
3. A reviewer approves the `Approve Production Deploy` job in GitHub Actions
4. Production deploy runs automatically

### Manual deploy (emergency only)

```bash
# Only use if CI is unavailable and the change is critical
cd workers/switchboard
npm run deploy:production

# Run smoke tests immediately after
WORKER_URL=https://api.sovereign.os \
TEST_USER_ID=<prod-test-uuid> \
node scripts/smoke-test.mjs
```

---

## Rollback

### Instant rollback via Cloudflare Dashboard

1. Go to **Workers & Pages** → `sovereign-switchboard-production`
2. Click **Deployments** tab
3. Find the last known-good deployment
4. Click **…** → **Rollback to this deployment**

### Rollback via CLI

```bash
# List recent deployments
wrangler deployments list --env production

# Roll back to a specific deployment
wrangler rollback <deployment-id> --env production
```

### Blue/green rollback (automated)

The `bluegreen_deploy.sh` script auto-rolls back staging if smoke tests fail:

```bash
CF_API_TOKEN=<token> CF_ACCOUNT_ID=<id> \
STAGING_WORKER_URL=https://api-staging.sovereign.os \
bash deploy/bluegreen_deploy.sh staging
# Will auto-rollback staging on smoke test failure
```

### Rollback time target

| Tier | Target |
|------|--------|
| Staging rollback | < 2 minutes |
| Production rollback | < 5 minutes |

---

## Secret Rotation

Secret rotation should be performed:
- Every 90 days (scheduled)
- Immediately upon suspected compromise
- When an engineer with access leaves the team

### Rotation procedure

```bash
# 1. Generate new secret value
NEW_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# 2. Deploy new secret to staging first
echo "$NEW_SECRET" | wrangler secret put GEMINI_API_KEY --env staging

# 3. Verify staging still works
node scripts/smoke-test.mjs

# 4. Deploy to production
echo "$NEW_SECRET" | wrangler secret put GEMINI_API_KEY --env production

# 5. Update GitHub Actions secret (via GitHub UI or gh CLI)
gh secret set STAGING_GEMINI_API_KEY --body "$NEW_SECRET"

# 6. Verify production
WORKER_URL=https://api.sovereign.os node scripts/smoke-test.mjs
```

### WORKER_HMAC_SECRET rotation (webhook break risk)

Rotating `WORKER_HMAC_SECRET` will invalidate all in-flight webhook signatures. To rotate safely:

1. Deploy new secret to staging, verify webhooks work
2. Coordinate with Stripe webhook configuration — update the secret in Stripe dashboard
3. Deploy to production during low-traffic window (e.g., 03:00 PDT)
4. Monitor `/health` and Slack alerts for 15 minutes post-rotation

---

## Health Checks

The `/health` endpoint provides a real-time status view:

```bash
# Staging
curl -s https://api-staging.sovereign.os/health | jq .

# Production
curl -s https://api.sovereign.os/health | jq .
```

Expected response:

```json
{
  "status": "healthy",
  "version": "1.0.0",
  "timestamp": "2026-05-09T17:00:00.000Z",
  "checks": {
    "supabase": "ok",
    "ai": "ok",
    "foundry": "ok"
  },
  "latency_ms": {
    "ai": 342,
    "db": 98,
    "foundry": 201
  }
}
```

`status` values:
- `healthy` — all checks pass → HTTP 200
- `degraded` — some checks pass → HTTP 503 (still serving traffic)
- `unhealthy` — all checks fail → HTTP 503

---

## Troubleshooting

### Worker returns 500 on all routes

1. Check Cloudflare Workers logs: **Dashboard → Workers → sovereign-switchboard → Logs**
2. Verify all secrets are set: `wrangler secret list --env production`
3. Check `/health` endpoint for failing subsystem

### CORS rejections in browser

Verify the request's `Origin` header matches an entry in `ALLOWED_ORIGINS` in `src/index.ts`. localhost:3000 and localhost:3001 are pre-allowed for dev.

### Supabase 401 errors from Worker

The `SUPABASE_SERVICE_ROLE_KEY` secret may be expired, truncated, or set incorrectly. Re-set it:

```bash
wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env production
```

### Gemini API errors (429 rate limit)

Gemini 1.5 Flash has generous limits but can be hit under load. The `ai_client.ts` does not retry on 429 (to avoid cascading). Options:
- Implement request queuing in the Worker
- Upgrade Gemini API tier
- Add Worker KV caching for identical prompts

### Wrangler deploy fails with "Script too large"

Bundle size limit is 1 MB compressed. Run:

```bash
wrangler deploy --dry-run --outdir dist --env staging
du -sh dist/
```

If over limit, audit `node_modules` for large transitive deps. The Vercel AI SDK is the main contributor.

### Streaming responses cut off

Cloudflare Workers have a 30-second CPU time limit per request. Streaming SSE responses can exceed wall-clock limits. The `stream_helpers.ts` enforces a 55-second timeout with a graceful `[DONE]` termination. If users report cut-off streams, check the `latency_ms.ai` field in `/health`.
