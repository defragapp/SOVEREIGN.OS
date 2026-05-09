#!/usr/bin/env bash
# ============================================================
# SOVEREIGN.OS — Blue/Green Cloudflare Worker Deploy
# Usage:
#   ./deploy/bluegreen_deploy.sh [staging|production] [--rollback]
# Requires: wrangler CLI authenticated, jq, curl
# ============================================================
set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────
WORKER_NAME="sovereign-switchboard"
STAGING_WORKER="${WORKER_NAME}-staging"
PRODUCTION_WORKER="${WORKER_NAME}"
HEALTH_PATH="/health"
SMOKE_SCRIPT="$(dirname "$0")/../scripts/smoke-test.mjs"
MAX_HEALTH_RETRIES=12
HEALTH_SLEEP=5
SLACK_WEBHOOK="${SLACK_WEBHOOK:-}"   # optional
LOG_FILE="$(dirname "$0")/../logs/deploy-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "$(dirname "$LOG_FILE")"

# ─── Args ─────────────────────────────────────────────────────────────────────
ENVIRONMENT="${1:-staging}"
ROLLBACK=false
if [[ "${2:-}" == "--rollback" ]]; then ROLLBACK=true; fi

# ─── Helpers ──────────────────────────────────────────────────────────────────
log()  { echo "[$(date -u +%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"; }
err()  { log "ERROR: $*"; exit 1; }
slack(){ [[ -n "$SLACK_WEBHOOK" ]] && curl -s -X POST "$SLACK_WEBHOOK" -H "Content-Type: application/json" -d "{\"text\":\"$*\"}" >/dev/null || true; }

health_check() {
  local url="$1"
  log "Health check → $url"
  for i in $(seq 1 $MAX_HEALTH_RETRIES); do
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" "${url}${HEALTH_PATH}" || echo "000")
    if [[ "$code" == "200" ]]; then
      log "Health OK (attempt $i)"
      return 0
    fi
    log "Health attempt $i/$MAX_HEALTH_RETRIES: HTTP $code — retrying in ${HEALTH_SLEEP}s"
    sleep $HEALTH_SLEEP
  done
  return 1
}

run_smoke() {
  local target_url="$1"
  if [[ ! -f "$SMOKE_SCRIPT" ]]; then
    log "Smoke test script not found — skipping"
    return 0
  fi
  log "Running smoke tests against $target_url"
  TARGET_WORKER_URL="$target_url" node "$SMOKE_SCRIPT" 2>&1 | tee -a "$LOG_FILE"
}

# ─── Rollback ─────────────────────────────────────────────────────────────────
if $ROLLBACK; then
  log "=== ROLLBACK INITIATED for $ENVIRONMENT ==="
  slack ":warning: SOVEREIGN rollback triggered for *$ENVIRONMENT* by ${GITHUB_ACTOR:-manual}"

  if [[ "$ENVIRONMENT" == "production" ]]; then
    # Revert to last tagged version
    LAST_TAG=$(git describe --tags --abbrev=0 HEAD~1 2>/dev/null || echo "")
    if [[ -z "$LAST_TAG" ]]; then err "No previous tag found — manual rollback required."; fi
    log "Rolling back to tag: $LAST_TAG"
    git checkout "$LAST_TAG" -- workers/switchboard/
    wrangler deploy --env production 2>&1 | tee -a "$LOG_FILE"
  else
    log "Rollback on staging: re-deploying HEAD"
    wrangler deploy --env staging 2>&1 | tee -a "$LOG_FILE"
  fi

  log "Rollback complete."
  slack ":white_check_mark: SOVEREIGN rollback complete for *$ENVIRONMENT*"
  exit 0
fi

# ─── Main Deploy ──────────────────────────────────────────────────────────────
log "=== SOVEREIGN.OS Blue/Green Deploy ==="
log "Environment : $ENVIRONMENT"
log "Timestamp   : $(date -u)"
log "Commit      : $(git rev-parse --short HEAD 2>/dev/null || echo 'N/A')"
slack ":rocket: SOVEREIGN deploy starting → *$ENVIRONMENT* @ $(git rev-parse --short HEAD 2>/dev/null)"

cd "$(dirname "$0")/../workers/switchboard"

if [[ "$ENVIRONMENT" == "staging" ]]; then
  # ── Staging ──────────────────────────────────────────────────────────────
  STAGING_URL="https://api-staging.sovereign.os"

  log "--- [1/3] Deploying to STAGING"
  wrangler deploy --env staging 2>&1 | tee -a "$LOG_FILE"

  log "--- [2/3] Health check (staging)"
  health_check "$STAGING_URL" || err "Staging health check failed — deploy aborted."

  log "--- [3/3] Smoke tests (staging)"
  run_smoke "$STAGING_URL"

  log "=== Staging deploy SUCCEEDED ==="
  slack ":white_check_mark: SOVEREIGN *staging* deploy succeeded."

elif [[ "$ENVIRONMENT" == "production" ]]; then
  # ── Production Blue/Green ─────────────────────────────────────────────────
  PROD_URL="https://api.sovereign.os"
  STAGING_URL="https://api-staging.sovereign.os"

  log "--- [1/5] Pre-flight: verifying staging is healthy"
  health_check "$STAGING_URL" || err "Staging is not healthy — refusing production deploy."

  log "--- [2/5] Deploying GREEN (production)"
  wrangler deploy --env production 2>&1 | tee -a "$LOG_FILE"

  log "--- [3/5] Health check (production)"
  if ! health_check "$PROD_URL"; then
    log "Production health check FAILED — initiating automatic rollback"
    slack ":sos: SOVEREIGN production health check failed — rolling back"
    LAST_TAG=$(git describe --tags --abbrev=0 HEAD~1 2>/dev/null || echo "")
    if [[ -n "$LAST_TAG" ]]; then
      git checkout "$LAST_TAG" -- .
      wrangler deploy --env production 2>&1 | tee -a "$LOG_FILE"
      log "Automatic rollback complete."
      slack ":white_check_mark: Rollback to $LAST_TAG complete."
    else
      err "No previous tag — manual rollback required immediately."
    fi
    exit 1
  fi

  log "--- [4/5] Smoke tests (production)"
  run_smoke "$PROD_URL"

  log "--- [5/5] Tagging release"
  TAG="v$(date +%Y%m%d%H%M%S)"
  git tag "$TAG" -m "Production deploy $(date -u)"
  git push origin "$TAG" || log "Warning: could not push tag (non-fatal)"

  log "=== Production deploy SUCCEEDED — $TAG ==="
  slack ":white_check_mark: SOVEREIGN *production* deploy succeeded → \`$TAG\`"

else
  err "Unknown environment: $ENVIRONMENT. Use 'staging' or 'production'."
fi
