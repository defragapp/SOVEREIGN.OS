# Sovereign AI Switchboard — Deployment Guide

> **Worker:** `sovereign-switchboard`  
> **Endpoint:** `https://api.sovereign.os`  
> **Staging:** `https://api-staging.sovereign.os`  
> **Stack:** Cloudflare Workers · Hono · Vercel AI SDK · Google Gemini

---

## Prerequisites

| Tool | Minimum Version | Install |
|------|----------------|---------|
| Node.js | 20 LTS | `nvm use 20` |
| Wrangler CLI | 3.88+ | `npm i -g wrangler` |
| Cloudflare account | — | `wrangler login` |
| GitHub Actions secrets | — | See §3 |

---

## 1. First-Time Setup

### 1.1 Clone and install

```bash
git clone https://github.com/defragapp/SOVEREIGN.OS.git
cd SOVEREIGN.OS
npm install
cd workers/switchboard && npm install
```

### 1.2 Authenticate Wrangler

```bash
wrangler login
# Verify: wrangler whoami
```

### 1.3 Create the Cloudflare zone route (one-time)

Log in to the Cloudflare dashboard → **Workers & Pages** → select `sovereign-switchboard` → **Triggers** → **Add Custom Domain** → `api.sovereign.os`.

---

## 2. Secret Provisioning

**All secrets are injected via `wrangler secret put` — never committed to the repository.**

### 2.1 Staging secrets

```bash
# Required
wrangler secret put GEMINI_API_KEY            --env staging
wrangler secret put SUPABASE_URL              --env staging
wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env staging
wrangler secret put FOUNDRY_API_URL           --env staging
wrangler secret put FOUNDRY_API_KEY           --env staging
wrangler secret put WEBHOOK_SECRET            --env staging

# Optional (observability)
wrangler secret put SENTRY_DSN               --env staging
wrangler secret put DATADOG_API_KEY          --env staging

# Optional (media upload)
wrangler secret put S3_BUCKET                --env staging
wrangler secret put S3_KEY                   --env staging
wrangler secret put S3_SECRET                --env staging
```

### 2.2 Production secrets

```bash
wrangler secret put GEMINI_API_KEY            --env production
wrangler secret put SUPABASE_URL              --env production
wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env production
wrangler secret put FOUNDRY_API_URL           --env production
wrangler secret put FOUNDRY_API_KEY           --env production
wrangler secret put WEBHOOK_SECRET            --env production
wrangler secret put SENTRY_DSN               --env production
wrangler secret put DATADOG_API_KEY          --env production
```

### 2.3 GitHub Actions secrets

Add these in **Settings → Secrets and variables → Actions**:

| Secret | Value |
|--------|-------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token (Workers: Edit scope) |
| `CLOUDFLARE_ACCOUNT_ID` | Your CF account ID |
| `TEST_AGENT_ID` | UUID for smoke test agent |
| `TEST_SESSION_ID` | UUID for smoke test session |
| `SMOKE_TEST_SECRET` | Any random string |
| `STAGING_SUPABASE_URL` | Staging Supabase project URL |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | Staging service role key |

### 2.4 Verify secrets are set

```bash
wrangler secret list --env staging
wrangler secret list --env production
```

---

## 3. Deploy

### 3.1 Manual deploy to staging

```bash
cd workers/switchboard
npm run deploy:staging
# Equivalent: wrangler deploy --env staging
```

### 3.2 Verify staging health

```bash
curl -s https://api-staging.sovereign.os/health | jq .
# Expected: {"status":"healthy","checks":{...}}
```

### 3.3 Run smoke tests against staging

```bash
WORKER_URL=https://api-staging.sovereign.os \
SUPABASE_URL=$STAGING_SUPABASE_URL \
SUPABASE_SERVICE_ROLE_KEY=$STAGING_SUPABASE_SERVICE_ROLE_KEY \
node scripts/smoke-test.mjs
```

### 3.4 Manual approval and production deploy

After smoke tests pass:

```bash
npm run deploy:production
# Equivalent: wrangler deploy --env production
```

**Or via CI:** The `worker-deploy.yml` workflow handles this automatically with a manual approval gate in the `production-gate` GitHub Environment.

---

## 4. CI/CD Pipeline

```
push to main → [lint+typecheck] → [unit tests] → [deploy staging]
             → [smoke tests staging] → [manual approval] → [deploy production]
```

Configure the `production-gate` environment in **GitHub → Settings → Environments → production-gate** with required reviewers.

---

## 5. Local Development

### 5.1 Start both services concurrently

```bash
# Terminal 1 — Worker (port 8787)
cd workers/switchboard
cp .env.local.example .env.local  # populate secrets
wrangler dev --env staging --local

# Terminal 2 — Next.js frontend (port 3000)
cd frontend
vercel dev
```

### 5.2 Configure local env

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_WORKER_URL=http://localhost:8787
LOCAL_WORKER_URL=http://localhost:8787
```

Create `workers/switchboard/.dev.vars` (gitignored):

```env
GEMINI_API_KEY=your_key_here
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
FOUNDRY_API_URL=https://your-foundry-instance.com
FOUNDRY_API_KEY=your_foundry_key
WEBHOOK_SECRET=dev-webhook-secret
ENVIRONMENT=development
```

### 5.3 The proxy shim

The file `frontend/pages/api/[...proxy].ts` transparently forwards all `/api/*` Next.js calls to the local Worker. This means existing frontend code that calls `/api/dispatch` continues to work locally without changes.

**The proxy is disabled in production** (`NODE_ENV=production`). In production, the frontend calls `https://api.sovereign.os` directly via `worker-client.ts`.

---

## 6. Rollback

### 6.1 Instant rollback via Wrangler

Wrangler keeps the last 10 deployments. To roll back:

```bash
# List recent deployments
wrangler deployments list --env production

# Roll back to a specific deployment ID
wrangler rollback <deployment-id> --env production
```

### 6.2 Rollback via Git tag

Each production deploy creates a Git tag `worker-YYYY-MM-DD-<sha>`. To roll back:

```bash
git checkout <tag>
cd workers/switchboard && npm run deploy:production
```

### 6.3 Emergency kill switch

To take the Worker offline immediately:

```bash
# Delete the production route (keeps the Worker deployed but unreachable)
wrangler routes delete <route-id> --zone <zone-id>

# Or disable via Cloudflare dashboard:
# Workers & Pages → sovereign-switchboard-production → Settings → Disable
```

---

## 7. Secret Rotation

### Rotating GEMINI_API_KEY

1. Generate a new key in Google AI Studio.
2. `wrangler secret put GEMINI_API_KEY --env production` (enter new key when prompted).
3. Cloudflare propagates new secrets within ~30 seconds — **zero downtime, no redeployment needed**.
4. Revoke the old key in Google AI Studio.
5. Verify health: `curl https://api.sovereign.os/health | jq .checks.ai`

### Rotating SUPABASE_SERVICE_ROLE_KEY

1. Generate a new service role key in Supabase Dashboard → Project Settings → API.
2. `wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env production`
3. Revoke the old key in Supabase after confirming the new one works.

### Rotating WEBHOOK_SECRET

1. Generate a new secret: `openssl rand -hex 32`
2. Update in Wrangler: `wrangler secret put WEBHOOK_SECRET --env production`
3. Update the secret in the originating webhook provider.

---

## 8. Monitoring

### Cloudflare Dashboard

- **Workers & Pages → sovereign-switchboard-production → Metrics**: Requests, errors, CPU time, duration.
- **Logs → Real-time Logs**: Live request logs (available on Paid plan).

### Health endpoint monitoring

Set up an uptime monitor (e.g., BetterUptime, Pingdom) on:
- `https://api.sovereign.os/health` — expected status 200, `status: "healthy"`

### Scheduled smoke tests

The `worker-smoke-tests.yml` workflow runs daily at 06:00 UTC against staging. On failure, it auto-creates a GitHub issue labeled `smoke-test-failure`.

---

## 9. Troubleshooting

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| `/health` returns `status: "degraded"` | AI or DB connectivity issue | Check Gemini API quota; verify Supabase URL |
| 422 on `/dispatch` | Schema validation failure | Check request body against `schemas.ts` |
| 504 on simulator | Stream timeout exceeded | Reduce `max_tokens`; check Worker CPU limits |
| 401 on `/webhook` | Signature mismatch | Verify `WEBHOOK_SECRET` matches sender |
| CORS error in browser | Origin not in allowed list | Add origin to `ALLOWED_ORIGINS` in `index.ts` |
| `wrangler dev` can't find bindings | `.dev.vars` missing | Create `workers/switchboard/.dev.vars` (see §5.2) |
