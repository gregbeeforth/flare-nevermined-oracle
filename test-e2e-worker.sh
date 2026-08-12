#!/bin/bash
set -e

echo "=== Flare Nevermined Oracle Cloudflare Worker E2E Test ==="
echo ""

# Load environment variables from .env file
set -a
source .env
set +a

# Target the Cloudflare Workers. Defaults to local `wrangler dev`
# (localhost:3000); override with BASE_URL=<worker-url> ./test-e2e-worker.sh
BASE_URL="${BASE_URL:-http://localhost:3000}"
REMOTE_URL="${REMOTE_URL:-https://flare-nevermined-oracle.flare-oracle.workers.dev}"
echo "Local base URL: $BASE_URL"
echo "Remote base URL: $REMOTE_URL"
echo ""

if [ -z "$JWT_SECRET" ]; then
  echo "WARNING: JWT_SECRET not set in .env; the worker must have it configured"
  echo "  (local dev: JWT_SECRET=... npx wrangler dev; remote: wrangler secret put JWT_SECRET)"
  echo ""
fi

run_test() {
  local BASE_URL="$1"
  local LABEL="$2"

  echo "=== E2E Test for $LABEL ($BASE_URL) ==="

  echo "--- Step 1: Health Check ---"
  HEALTH=$(curl -s "$BASE_URL/health")
  echo "$HEALTH" | python3 -m json.tool
  echo ""

  echo "--- Step 2: Get x402 Token ---"
  if [ -n "$NVM_API_KEY" ] && [ -n "$NVM_PLAN_ID" ] && [ -n "$NVM_AGENT_ID" ]; then
    X402_TOKEN=$(NVM_API_KEY="$NVM_API_KEY" NVM_PLAN_ID="$NVM_PLAN_ID" NVM_AGENT_ID="$NVM_AGENT_ID" node get-x402-token.mjs 2>/dev/null)
    if [ -z "$X402_TOKEN" ]; then
      echo "ERROR: Failed to get x402 token from Nevermined"
      return 1
    fi
    echo "x402 token obtained from Nevermined (${#X402_TOKEN} chars)"
  else
    echo "! NVM_API_KEY / NVM_PLAN_ID / NVM_AGENT_ID missing"
    echo "! Fabricating a local x402 token (the exchange endpoint does not verify signatures)"
    X402_TOKEN=$(node -e "console.log(Buffer.from(JSON.stringify({x402Version:'1.0',accepted:{planId:'test-plan',extra:{agentId:'e2e-worker'}}})).toString('base64url'))")
  fi
  echo ""

  echo "--- Step 3: Exchange x402 Token for JWT ---"
  PROXY_TOKEN=$(curl -s -X POST "$BASE_URL/api/v1/x402/exchange" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $X402_TOKEN" | jq -r '.token')
  if [ -z "$PROXY_TOKEN" ] || [ "$PROXY_TOKEN" = "null" ]; then
    echo "ERROR: Failed to exchange x402 token for JWT"
    return 1
  fi
  echo "JWT obtained (${#PROXY_TOKEN} chars)"
  echo ""

  echo "--- Step 4: Query Feed ---"
  FEED=$(curl -s -H "Authorization: Bearer $PROXY_TOKEN" "$BASE_URL/api/v1/feed")
  echo "Response:"
  echo "$FEED"
  echo ""
  echo "Pretty-printed:"
  echo "$FEED" | python3 -m json.tool
  echo ""

  echo "=== E2E Test Complete for $LABEL ==="
  echo ""
}

run_test "$BASE_URL" "local worker"

if [ "$RUN_LOCAL_ONLY" != "1" ]; then
  run_test "$REMOTE_URL" "remote worker"
fi