# Migration Notes — Next.js API Routes → Cloudflare Worker

> Branch: `finish/worker-switchboard`
> Date: 2026-05-09

---

## Overview

This migration severs all AI-serving logic from the Next.js monorepo and moves it into the standalone Cloudflare Worker at `api.sovereign.os`. The Next.js app retains only:

- Auth routes (`/api/auth/[...nextauth]`)
- Profile routes (`/api/profile`)
- Subscription/billing routes (`/api/subscription`)
- Static frontend (pages, components, styles)

**Everything AI-related** (alignment, compression, defrag, loop, covenant, launcher) moves to the Worker.

---

## Routes Removed from Next.js

Delete these files from `frontend/pages/api/`:

```
frontend/pages/api/alignment/      → DELETE
frontend/pages/api/compression/    → DELETE
frontend/pages/api/defrag/         → DELETE
frontend/pages/api/loop/           → DELETE
frontend/pages/api/covenant/       → DELETE
frontend/pages/api/launcher/       → DELETE
```

> **Keep**: `frontend/pages/api/auth/`, `frontend/pages/api/profile/`, `frontend/pages/api/subscription/`

---

## Local Dev Compatibility Shim

The `next.config.ts` already has a dev proxy rewrite:

```typescript
// Already in frontend/next.config.ts — no change needed
async rewrites() {
  return process.env.NODE_ENV === "development"
    ? [{ source: "/api/worker/:path*", destination: "http://localhost:8787/:path*" }]
    : [];
},
```

This means:
- **Development**: `fetch("/api/worker/dispatch")` → Miniflare at `localhost:8787`
- **Production**: `fetch("https://api.sovereign.os/dispatch")` → CF Worker

The `NEXT_PUBLIC_WORKER_URL` env var controls the production URL. It's already set to `https://api.sovereign.os` in Vercel.

---

## Frontend Hook Migration

Replace all direct `fetch("/api/alignment")` etc. calls with the new hooks:

### Before (old pattern)

```typescript
// Old: calls Next.js API route
const res = await fetch("/api/alignment", {
  method: "POST",
  body: JSON.stringify({ dob, question }),
});
```

### After (new pattern)

```typescript
// New: uses useAlignment hook → Worker
import { useAlignment } from "@/hooks/useAlignment";
const { run, result, status, errorMessage } = useAlignment();
// In component:
await run({ dob, question, depth: "standard" }, session.user.id);
```

### Hook file mapping

| Old pattern | New hook | New file |
|-------------|----------|----------|
| `fetch("/api/alignment")` | `useAlignment` | `frontend/src/hooks/useAlignment.ts` |
| `fetch("/api/compression")` | `useCompression` | `frontend/src/hooks/useCompression.ts` |
| `fetch("/api/loop")` | `useSimulator` | `frontend/src/hooks/useSimulator.ts` |
| `fetch("/api/defrag")` | Direct via `workerDispatch` | `frontend/lib/worker-client.ts` |
| `fetch("/api/launcher")` | Direct via `workerDispatch` | `frontend/lib/worker-client.ts` |

---

## Environment Variables — Vercel

Ensure these are set in Vercel (dashboard → Project → Settings → Environment Variables):

| Variable | Value (production) | Value (staging) |
|----------|-------------------|-----------------|
| `NEXT_PUBLIC_WORKER_URL` | `https://api.sovereign.os` | `https://api-staging.sovereign.os` |

All AI-related env vars (`GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, etc.) are now **Worker secrets only** — remove them from Vercel if they were previously set there.

---

## DNS Setup

Add the following DNS records in Cloudflare:

| Type | Name | Target |
|------|------|--------|
| CNAME | `api` | `sovereign-switchboard-production.your-account.workers.dev` |
| CNAME | `api-staging` | `sovereign-switchboard-staging.your-account.workers.dev` |

Enable **Proxied** (orange cloud) for both records.

The `wrangler.toml` routes are:
- Staging: `api-staging.sovereign.os/*`
- Production: `api.sovereign.os/*`

---

## PR Checklist

### PR 1: Worker Implementation

- [ ] `workers/switchboard/src/index.ts`
- [ ] `workers/switchboard/src/schemas.ts`
- [ ] `workers/switchboard/src/ai_client.ts`
- [ ] `workers/switchboard/src/supabase_client.ts`
- [ ] `workers/switchboard/src/foundry_client.ts`
- [ ] `workers/switchboard/src/stream_helpers.ts`
- [ ] `workers/switchboard/package.json`
- [ ] `workers/switchboard/tsconfig.json`
- [ ] `workers/switchboard/vitest.config.ts`
- [ ] `workers/switchboard/tests/schemas.test.ts`
- [ ] `workers/switchboard/tests/ai_client.test.ts`
- [ ] `wrangler.toml`
- [ ] All secrets set on staging via `wrangler secret put`

### PR 2: Frontend Integration

- [ ] `frontend/src/hooks/useAlignment.ts`
- [ ] `frontend/src/hooks/useCompression.ts`
- [ ] `frontend/src/hooks/useSimulator.ts`
- [ ] `frontend/lib/worker-client.ts`
- [ ] Old API route files deleted
- [ ] `NEXT_PUBLIC_WORKER_URL` set in Vercel

### PR 3: CI & Ops

- [ ] `.github/workflows/worker-deploy.yml`
- [ ] `.github/workflows/worker-smoke-tests.yml`
- [ ] `scripts/smoke-test.mjs`
- [ ] `scripts/supabase-verify.mjs`
- [ ] `deploy/bluegreen_deploy.sh`
- [ ] `docs/worker-deploy.md`
- [ ] `docs/worker-security.md`
- [ ] GitHub Environments configured (staging, production-gate, production)
- [ ] GitHub Actions secrets set

---

## Acceptance Criteria

- [ ] `GET /health` returns `status: "healthy"` with supabase + ai checks passing
- [ ] `POST /dispatch` with `space: "alignment"` returns valid `AlignmentResponse` JSON
- [ ] `POST /dispatch` with `space: "compression"` returns valid `CompressionResponse` JSON (Pro user)
- [ ] `POST /dispatch` with `space: "the_loop"` streams SSE tokens to browser
- [ ] `POST /dispatch` with free-tier user on `space: "compression"` returns 403
- [ ] `POST /dispatch` after 5+ alignment calls returns 429
- [ ] Unit tests: `npm test` passes with 0 failures
- [ ] Smoke tests: `node scripts/smoke-test.mjs` passes all assertions
- [ ] Supabase verify: `node scripts/supabase-verify.mjs` passes all assertions
- [ ] CI: staging deploy triggers on merge to main
- [ ] CI: production deploy requires manual approval in `production-gate`
- [ ] No secrets committed (verify with `git log --all -- '*.env*' '*.vars*'`)

---

## Rollback Plan

If the Worker deploy causes issues:

1. **Immediate (< 2 min):** Roll back via Cloudflare Dashboard → Deployments → Rollback
2. **Restore Next.js routes:** Revert the PR that deleted `/api/alignment` etc.
3. **Re-point frontend:** Set `NEXT_PUBLIC_WORKER_URL` back to `/api/worker` or remove it (defaults to internal routes)

The frontend's dev proxy shim means local development is always isolated from production, so a staging-only rollback does not affect developers.
