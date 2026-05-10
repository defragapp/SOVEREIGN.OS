# SOVEREIGN.OS

> *Clarity for yourself, and the people you care about.*

Sovereign is a cinematic, privacy-first consumer platform with six intelligent spaces for personal clarity, relationship insight, and spiritual guidance. Built on a Cloudflare Worker AI Switchboard, Next.js PWA frontend, and Supabase PostgreSQL.

---

## Architecture Overview

```
âââââââââââââââââââââââââââââââââââââââââââââââââââââââ
â  sovereign.os (Vercel Â· Next.js 15 PWA)             â
â  Six spaces: Launcher Â· Defrag Â· Alignment Â·        â
â              The Loop Â· Compression Â· Covenant       â
ââââââââââââââââââââ¬âââââââââââââââââââââââââââââââââââ
                   â HTTPS  fetch to api.sovereign.os
ââââââââââââââââââââ¼âââââââââââââââââââââââââââââââââââ
â  api.sovereign.os (Cloudflare Worker Â· Hono v4)     â
â  /dispatch  /health  /webhook                       â
â  Vercel AI SDK â Google Gemini 1.5 Pro / Flash      â
ââââââââ¬âââââââââââââââââââââââââââââââââââââââââââââââ
       â PostgREST (HTTPS only)
ââââââââ¼âââââââââââââââââââââââââââââââââââââââââââââââ
â  Supabase PostgreSQL                                â
â  pgvector 768-dim Â· RLS Â· Credits ledger            â
âââââââââââââââââââââââââââââââââââââââââââââââââââââââ
```

---

## Monorepo Structure

```
SOVEREIGN.OS/
âââ agents/                  # Agent manifest schema + validator
âââ auth/                    # NextAuth config (shared by frontend)
âââ backend/
â   âââ astrology/           # Natal chart + transits service
â   âââ stripe/              # Idempotent webhook handler
â   âââ synthesis/           # Multi-source synthesis engine
âââ db/
â   âââ migrations/          # SQL schema migrations
âââ deploy/                  # Blue/green deploy script
âââ docs/                    # Deploy & security docs
âââ frontend/                # Next.js 15 PWA
â   âââ components/          # Shared UI: Nav, SubscriptionGate, ProfileGate
â   âââ i18n/                # i18n strings (zero clinical language)
â   âââ lib/                 # subscription.ts, worker-client
â   âââ pages/               # All routes (six spaces + auth + billing)
â   âââ src/hooks/           # useAlignment, useCompression, useSimulator
â   âââ styles/              # Chrome & Bone design system (globals.css)
âââ media/                   # Media pipeline (story â video)
âââ public/                  # manifest.json, sw.js, icons
âââ qa/                      # QA sign-off template
âââ scripts/                 # Smoke tests + Supabase verify
âââ workers/
â   âââ switchboard/         # Cloudflare Worker (Hono + Vercel AI SDK)
â       âââ src/             # index.ts, schemas, clients, stream helpers
â       âââ tests/           # vitest unit tests
âââ .github/workflows/       # CI/CD: deploy + smoke tests
```

---

## Six Spaces

| Space | Hook | Tier | Route |
|-------|------|------|-------|
| **Launcher** | Clarity for yourself, and the people you care about. | Free | `/launcher` |
| **Defrag** | See the patterns before they become arguments. | Free Â· 3Ã/day | `/defrag` |
| **Alignment** | Find your center. Know your next right step. | Free Â· 5Ã/day | `/alignment` |
| **The Loop** | Stuck in a loop? Let us show you the way out. | Free Â· 3Ã/day | `/loop` |
| **Compression** | From overwhelm to absolute clarity in seconds. | Pro | `/compression` |
| **Covenant** | Timeless wisdom for today's relationships. | Pro | `/covenant` |

---

## Quick Start â Local Development

### Prerequisites

- Node.js 20+
- pnpm 9+ (or npm)
- Wrangler CLI: `npm i -g wrangler`
- A Supabase project with the schema applied (see below)

### 1. Clone & Install

```bash
git clone https://github.com/defragapp/SOVEREIGN.OS.git
cd SOVEREIGN.OS

# Install Worker deps
cd workers/switchboard && npm install && cd ../..

# Install Frontend deps
cd frontend && npm install && cd ..
```

### 2. Configure Environment

```bash
cp .env.example .env.local
# Fill in all values â see .env.example for descriptions
```

### 3. Apply Database Schema

```sql
-- In Supabase SQL Editor, run:
-- db/migrations/20260509_create_credits_ledger.sql
```

Or via CLI:
```bash
supabase db push
```

### 4. Run Locally

**Terminal 1 â Cloudflare Worker (port 8787):**
```bash
cd workers/switchboard
wrangler dev --env staging
```

**Terminal 2 â Next.js Frontend (port 3000):**
```bash
cd frontend
npm run dev
```

The frontend proxy rewrites `/api/worker/*` â `http://localhost:8787` in dev mode.

---

## Secrets & Environment Variables

### Cloudflare Worker Secrets

Set via `wrangler secret put` â never committed to the repo.

```bash
# Required (both staging and production)
wrangler secret put GEMINI_API_KEY             --env staging
wrangler secret put SUPABASE_URL               --env staging
wrangler secret put SUPABASE_SERVICE_ROLE_KEY  --env staging
wrangler secret put FOUNDRY_API_URL            --env staging
wrangler secret put FOUNDRY_API_KEY            --env staging
wrangler secret put WORKER_HMAC_SECRET         --env staging

# Optional
wrangler secret put SENTRY_DSN                 --env staging
wrangler secret put DATADOG_API_KEY            --env staging
```

Repeat with `--env production` for the production environment.

### GitHub Actions Secrets

Add at `github.com/defragapp/SOVEREIGN.OS/settings/secrets/actions`:

| Secret | Value |
|--------|-------|
| `CF_API_TOKEN` | Cloudflare API token (Workers:Edit) |
| `CF_ACCOUNT_ID` | Cloudflare account ID |
| `STAGING_SUPABASE_URL` | Staging Supabase project URL |
| `STAGING_SUPABASE_ANON_KEY` | Staging Supabase anon key |
| `STAGING_GEMINI_API_KEY` | Gemini API key for smoke tests |
| `SLACK_WEBHOOK_URL` | (Optional) Slack deploy notifications |
| `SENTRY_DSN` | (Optional) Sentry DSN |

### Vercel Frontend Env Vars

Set at `vercel.com/defragapp/sovereign-os/settings/environment-variables`:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_WORKER_URL` | `https://api.sovereign.os` |
| `NEXT_PUBLIC_APP_URL` | `https://sovereign.os` |
| `NEXTAUTH_SECRET` | (generate: `openssl rand -base64 32`) |
| `NEXTAUTH_URL` | `https://sovereign.os` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `APPLE_ID` | Apple OAuth app ID |
| `APPLE_TEAM_ID` | Apple team ID |
| `APPLE_PRIVATE_KEY` | Apple private key |
| `APPLE_KEY_ID` | Apple key ID |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |

---

## Deployment

### Cloudflare Worker

**Staging (automatic on merge to `main`):**
```bash
# Handled by .github/workflows/worker-deploy.yml
# lint â test â deploy staging â smoke tests â manual gate â deploy production
```

**Manual blue/green deploy:**
```bash
bash deploy/bluegreen_deploy.sh
# Rollback: bash deploy/bluegreen_deploy.sh --rollback
```

### Frontend (Vercel)

1. Import repo at `vercel.com/new`
2. Set **Root Directory** to `frontend`
3. Set **Framework** to `Next.js`
4. Add all env vars listed above
5. Deploy

### Stripe Webhook

Register at `dashboard.stripe.com/webhooks`:
- **Endpoint:** `https://api.sovereign.os/webhook`
- **Events:** `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`

### DNS

| Record | Type | Value |
|--------|------|-------|
| `sovereign.os` | CNAME | `cname.vercel-dns.com` |
| `api.sovereign.os` | CNAME / Worker Route | Cloudflare Worker route |

---

## CI/CD

| Workflow | Trigger | Steps |
|----------|---------|-------|
| `worker-deploy.yml` | Push to `main` | lint â test â staging deploy â smoke tests â manual approval â production |
| `worker-smoke-tests.yml` | Daily 06:00 UTC + manual | Full smoke suite against staging; opens GitHub issue on failure |

---

## Testing

```bash
# Unit tests (Worker)
cd workers/switchboard
npm test

# Smoke tests (against staging Worker)
node scripts/smoke-test.mjs --suite all

# Supabase verify
node scripts/supabase-verify.mjs
```

---

## Design System

**Chrome & Bone** â cinematic dark UI.

| Token | Value |
|-------|-------|
| Base | `#080808` |
| Chrome (primary text) | `#c8c8c8` |
| Muted text | `rgba(200,200,200,0.45)` |
| Glass panel | `rgba(255,255,255,0.04)` + `blur(20px)` |
| Font display | Playfair Display |
| Font body | Inter |
| Defrag accent | `#10b981` |
| Alignment accent | `#818cf8` |
| Loop accent | `#f59e0b` |
| Compression accent | `#f472b6` |
| Covenant accent | `#d97706` |

---

## UX Copy Rules

> The backend speaks in systems. The product speaks in humanity.

- **Never** use: generate, process, analyze, data, model, diagnose, pattern-match, algorithm
- **Always** use: understand, discover, explore, find, feel, guide, reflect, move forward
- **Tone:** calm, warm, cinematic, precise â never preachy or clinical

---

## Security

See `docs/worker-security.md` for full details:
- CORS enforced to `sovereign.os` and `localhost` in dev
- HMAC webhook verification
- Rate limiting via Cloudflare
- All PII encrypted at rest via Supabase RLS
- No direct TCP â PostgREST HTTPS only from edge

---

## License

Private. All rights reserved. Â© 2026 Defrag App, Inc.
