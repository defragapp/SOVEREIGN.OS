## Sovereign.OS — Build TODO (Sprint 1)
- [ ] Create monorepo folders:
      apps/api, apps/web, packages/contracts, packages/orchestration,
      packages/prompts, packages/safety, docs
- [ ] Initialize root package.json with workspace config
- [ ] Scaffold packages/contracts with dispatch schema (Zod)
- [ ] Scaffold apps/api Cloudflare Worker with:
      - /health route
      - /dispatch route
      - wrangler.toml
- [ ] Scaffold apps/web Next.js placeholder page
- [ ] Add fetch call to /dispatch
- [ ] Install Wrangler and configure staging environment
- [ ] Deploy Worker to staging
- [ ] Add docs/deploy.md with exact commands
- [ ] Run smoke tests and document results
