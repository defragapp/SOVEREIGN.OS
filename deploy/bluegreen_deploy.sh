#!/usr/bin/env bash
# deploy/bluegreen_deploy.sh
# Blue/green deploy for the Sovereign AI Switchboard.
# Strategy: deploy new version to staging → run smoke tests → promote to production.
# Requires: wrangler CLI, node >= 20, CF_API_TOKEN, CF_ACCOUNT_ID env vars.

set -euo pipefail

# ─── Config ────────────────────────────────────────────────────────────────────

WORKER_DIR="workers/switchboard"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SMOKE_RESULTS="/tmp/bluegreen-smoke-results.json"

# ─── Colors ────────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Colour

info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[FAIL]${NC} $*" >&2; }
die()     { error "$*"; exit 1; }

# ─── Arg parsing ───────────────────────────────────────────────────────────────

ENVIRONMENT="${1:-staging}"
SKIP_TESTS="${2:-false}"
DRY_RUN="${3:-false}"

case "$ENVIRONMENT" in
  staging|production) ;;
  *) die "Usage: $0 [staging|production] [skip-tests=false] [dry-run=false]";;
esac

# ─── Pre-flight checks ─────────────────────────────────────────────────────────

info "Pre-flight checks..."

command -v wrangler >/dev/null 2>&1 || die "wrangler CLI not found. Run: npm i -g wrangler"
command -v node >/dev/null 2>&1 || die "node not found"
command -v npm >/dev/null 2>&1 || die "npm not found"

[[ -n "${CF_API_TOKEN:-}" ]] || die "CF_API_TOKEN is not set"
[[ -n "${CF_ACCOUNT_ID:-}" ]] || die "CF_ACCOUNT_ID is not set"

# Verify wrangler is authenticated
wrangler whoami >/dev/null 2>&1 || die "wrangler not authenticated. Run: wrangler login"

success "Pre-flight checks passed"

# ─── Install deps ──────────────────────────────────────────────────────────────

info "Installing Worker dependencies..."
cd "${REPO_ROOT}/${WORKER_DIR}"
npm ci --silent
success "Dependencies installed"

# ─── Type-check ────────────────────────────────────────────────────────────────

info "Running TypeScript type-check..."
npm run type-check || die "Type-check failed. Fix errors before deploying."
success "Type-check passed"

# ─── Unit tests ────────────────────────────────────────────────────────────────

if [[ "$SKIP_TESTS" != "skip-tests" && "$SKIP_TESTS" != "true" ]]; then
  info "Running unit tests..."
  npm test -- --reporter=verbose || die "Unit tests failed. Aborting deploy."
  success "Unit tests passed"
else
  warn "Unit tests SKIPPED (explicit skip requested)"
fi

cd "${REPO_ROOT}"

# ─── Deploy ────────────────────────────────────────────────────────────────────

info "Deploying to ${ENVIRONMENT}..."

if [[ "$DRY_RUN" == "dry-run" || "$DRY_RUN" == "true" ]]; then
  warn "DRY RUN — skipping actual deploy"
  info "Would run: wrangler deploy --env ${ENVIRONMENT}"
else
  CLOUDFLARE_API_TOKEN="${CF_API_TOKEN}" \
  CLOUDFLARE_ACCOUNT_ID="${CF_ACCOUNT_ID}" \
  wrangler deploy --env "${ENVIRONMENT}" --config wrangler.toml \
    || die "Wrangler deploy to ${ENVIRONMENT} failed"
  success "Deployed to ${ENVIRONMENT}"
fi

# ─── Smoke tests (staging only by default) ────────────────────────────────────

if [[ "$ENVIRONMENT" == "staging" && "$SKIP_TESTS" != "skip-tests" && "$DRY_RUN" != "true" ]]; then
  info "Running smoke tests against staging..."

  WORKER_URL="${STAGING_WORKER_URL:-https://api-staging.sovereign.os}" \
  TEST_USER_ID="${STAGING_TEST_USER_ID:-}" \
  node "${REPO_ROOT}/scripts/smoke-test.mjs" \
    && success "Smoke tests passed" \
    || {
      error "Smoke tests FAILED"
      warn "Initiating rollback to previous version..."
      rollback_staging
      die "Deploy rolled back due to smoke test failure"
    }
fi

# ─── Production promotion prompt ──────────────────────────────────────────────

if [[ "$ENVIRONMENT" == "staging" ]]; then
  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  Staging deploy successful. Ready for production.${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  read -r -p "Promote to PRODUCTION? (yes/N): " confirm
  if [[ "$confirm" == "yes" ]]; then
    CLOUDFLARE_API_TOKEN="${CF_API_TOKEN}" \
    CLOUDFLARE_ACCOUNT_ID="${CF_ACCOUNT_ID}" \
    wrangler deploy --env production --config wrangler.toml \
      && success "Deployed to PRODUCTION" \
      || die "Production deploy failed"
  else
    info "Production deploy skipped. Run again with: $0 production"
  fi
fi

# ─── Rollback helper ──────────────────────────────────────────────────────────

rollback_staging() {
  warn "Rolling back staging to previous deployment..."
  # Cloudflare Workers rollback via API
  local rollback_url="https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/workers/scripts/sovereign-switchboard-staging/deployments"
  local deployments
  deployments=$(curl -s -X GET "${rollback_url}" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json")

  local prev_id
  prev_id=$(echo "$deployments" | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const deploys = d.result?.items ?? [];
    // Get the second most recent (index 1)
    console.log(deploys[1]?.id ?? '');
  " 2>/dev/null || echo "")

  if [[ -z "$prev_id" ]]; then
    warn "No previous deployment found for rollback"
    return 1
  fi

  curl -s -X POST "${rollback_url}/${prev_id}/rollback" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    && success "Rolled back to deployment ${prev_id}" \
    || warn "Rollback API call failed — check Cloudflare dashboard"
}

# ─── Done ─────────────────────────────────────────────────────────────────────

echo ""
success "Deploy to ${ENVIRONMENT} complete ✓"
echo ""
