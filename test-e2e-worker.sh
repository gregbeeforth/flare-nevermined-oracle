#!/bin/bash
set -e

echo "=== Flare Nevermined Oracle Cloudflare Worker E2E Test ==="
echo ""

# Load environment variables from .env file
set -a
source .env
set +a

# Remote worker: the deployed Cloudflare Worker the Nevermined agent points to.
# Override with REMOTE_URL=<url>.
REMOTE_URL="${REMOTE_URL:-https://flare-nevermined-oracle.flare-oracle.workers.dev}"
# Local worker (opt-in): a `wrangler dev` instance. Override with LOCAL_URL=<url>.
LOCAL_URL="${LOCAL_URL:-http://localhost:3000}"
echo "Remote worker URL: $REMOTE_URL"
echo "Local worker URL:  $LOCAL_URL  (set RUN_LOCAL=1 to test locally too)"
echo ""

if [ -z "$JWT_SECRET" ]; then
  echo "WARNING: JWT_SECRET not set in .env; the worker must have it configured"
  echo "  (local dev: JWT_SECRET=... npx wrangler dev; remote: wrangler secret put JWT_SECRET)"
  echo ""
fi

run_test() {
  local BASE_URL="$1"
  local LABEL="$2"
  local EXPECT_SUB="$3"

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
    EXPECT_SUB="e2e-worker"
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

  JWT_SUB=$(node -e "console.log(JSON.parse(Buffer.from(process.argv[1].split('.')[1], 'base64url').toString()).sub)" "$PROXY_TOKEN")
  echo "JWT subject (sub): $JWT_SUB"
  if [ -n "$EXPECT_SUB" ] && [ "$JWT_SUB" != "$EXPECT_SUB" ]; then
    echo "ERROR: JWT sub ($JWT_SUB) does not match expected agent ID ($EXPECT_SUB)"
    return 1
  fi
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

run_test "$REMOTE_URL" "remote worker" "$NVM_AGENT_ID"

if [ "$RUN_LOCAL" = "1" ]; then
  run_test "$LOCAL_URL" "local worker" "$NVM_AGENT_ID"
fi
