#!/bin/bash
set -e

echo "=== Flare Nevermined Oracle E2E Test ==="
echo ""

BASE_URL="https://nevermined-oracle-7c351.containers.snapdeploy.app"

echo "--- Step 1: Health Check ---"
HEALTH=$(curl -s "$BASE_URL/health")
echo "$HEALTH" | python3 -m json.tool
echo ""

echo "--- Step 2: Get x402 Token ---"
X402_TOKEN=$(NVM_API_KEY="$NVM_API_KEY" NVM_PLAN_ID="$NVM_PLAN_ID" NVM_AGENT_ID="$NVM_AGENT_ID" node get-x402-token.mjs 2>/dev/null)
if [ -z "$X402_TOKEN" ]; then
  echo "ERROR: Failed to get x402 token"
  exit 1
fi
echo "x402 token obtained (${#X402_TOKEN} chars)"
echo ""

echo "--- Step 3: Exchange x402 Token for JWT ---"
PROXY_TOKEN=$(curl -s -X POST "$BASE_URL/api/v1/x402/exchange" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $X402_TOKEN" | jq -r '.token')
if [ -z "$PROXY_TOKEN" ] || [ "$PROXY_TOKEN" = "null" ]; then
  echo "ERROR: Failed to exchange x402 token for JWT"
  exit 1
fi
echo "JWT obtained (${#PROXY_TOKEN} chars)"
echo ""

echo "--- Step 4: Query Feed ---"
FEED=$(curl -s -H "Authorization: Bearer $PROXY_TOKEN" "$BASE_URL/api/v1/feed")
echo "$FEED" | python3 -m json.tool
echo ""

echo "=== E2E Test Complete ==="