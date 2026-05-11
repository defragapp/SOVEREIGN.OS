# Migration Map

## Existing Folders and Files
- `app/` (Next.js App Router) -> MIGRATE-LATER (to `apps/web/app/`)
- `pages/` (Next.js Pages/API Routes) -> MIGRATE-LATER (to `apps/web/pages/` or API routes to `apps/api/`)
- `workers/` (Cloudflare Workers) -> MIGRATE-LATER (to `apps/api/`)
- `lib/` (Shared utilities, AI clients) -> MIGRATE-LATER (to various `packages/*` e.g., `packages/orchestration`, `packages/prompts`)
- `public/` (Static assets) -> MIGRATE-LATER (to `apps/web/public/`)
- `docs/` -> KEEP-AS-IS
- `.env.local.example` -> KEEP-AS-IS (or migrate to specific app)
- `.gitignore` -> KEEP-AS-IS
- `next.config.js` -> MIGRATE-LATER (to `apps/web/next.config.js`)
- `package.json` -> KEEP-AS-IS (modified for workspaces)
- `tsconfig.json` -> KEEP-AS-IS (will be base config)
- `.github/` -> KEEP-AS-IS
- `.mcp/` -> KEEP-AS-IS
- `.vscode/` -> KEEP-AS-IS
