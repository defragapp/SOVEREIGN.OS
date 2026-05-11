# Runbook: Sovereign.OS quick

## Build frontend
npm --prefix apps/web ci
npm --prefix apps/web run build

## Publish frontend (Cloudflare Pages SSR)
1. npx wrangler login
2. npm --prefix apps/web ci
3. npm --prefix apps/web run build:pages
4. npx wrangler pages publish apps/web/.output --project-name=defragapp-pages --branch=main

## Deploy auth Worker
cd apps/api
npx wrangler secret put JWT_SECRET
npx wrangler publish

## Domains
- marketing: defrag.app
- app: sovereign.defrag.app
- auth: auth.defrag.app

## SSO cookie
Set cookie Domain to .defrag.app; HttpOnly; Secure; SameSite=Lax
