#!/bin/bash
set -e

echo "=== Flare Nevermined Oracle E2E Test ==="
echo ""

set -a
source .env
set +a

BASE_URL="https://nevermined-oracle-7c351.containers.snapdeploy.app"

echo "--- Step 1: Health Check ---"
HEALTH=$(curl -s "$BASE_URL/health")
echo "$HEALTH" | python3 -m json.tool
echo ""

echo "--- Step 2: Get x402 Token (real purchase via Nevermined SDK) ---"
X402_TOKEN=$(NVM_API_KEY="$NVM_API_KEY" NVM_PLAN_ID="$NVM_PLAN_ID" NVM_AGENT_ID="$NVM_AGENT_ID" node get-x402-token.mjs 2>/dev/null)
if [ -z "$X402_TOKEN" ]; then
  echo "ERROR: Failed to get x402 token"
  exit 1
fi
echo "x402 token obtained (${#X402_TOKEN} chars)"
echo ""

echo "--- Step 3: Exchange x402 Token for JWT (proxy verifies payment via facilitator) ---"
PROXY_TOKEN=$(curl -s -X POST "$BASE_URL/api/v1/x402/exchange" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $X402_TOKEN" | jq -r '.token')
if [ -z "$PROXY_TOKEN" ] || [ "$PROXY_TOKEN" = "null" ]; then
  echo "ERROR: Failed to exchange x402 token for JWT"
  exit 1
fi
echo "JWT obtained (${#PROXY_TOKEN} chars)"
echo ""

echo "--- Step 4: Query Feed with JWT ---"
FEED=$(curl -s -H "Authorization: Bearer $PROXY_TOKEN" "$BASE_URL/api/v1/feed")
echo "$FEED" | python3 -m json.tool
echo ""

echo "--- Step 5: Verify feed data structure ---"
FEED_SUCCESS=$(echo "$FEED" | jq -r '.success')
FEED_DATA=$(echo "$FEED" | jq -r '.data')
if [ "$FEED_SUCCESS" != "true" ]; then
  echo "ERROR: Feed request did not return success"
  exit 1
fi
if [ "$FEED_DATA" = "null" ] || [ -z "$FEED_DATA" ]; then
  echo "ERROR: Feed data is empty"
  exit 1
fi
echo "Feed data verified"
echo ""

echo "--- Step 6: Test invalid x402 token is rejected by proxy ---"
INVALID_EXCHANGE=$(curl -s -X POST "$BASE_URL/api/v1/x402/exchange" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer invalid_x402_token")
INVALID_ERROR=$(echo "$INVALID_EXCHANGE" | jq -r '.error')
if [ "$INVALID_ERROR" = "null" ] || [ -z "$INVALID_ERROR" ]; then
  echo "WARNING: Invalid x402 token was not rejected (proxy may be skipping verification)"
else
  echo "Invalid x402 token correctly rejected: $INVALID_ERROR"
fi
echo ""

echo "--- Step 7: Test missing auth header is rejected by proxy ---"
NO_AUTH_EXCHANGE=$(curl -s -X POST "$BASE_URL/api/v1/x402/exchange" \
  -H "Content-Type: application/json")
NO_AUTH_STATUS=$(echo "$NO_AUTH_EXCHANGE" | jq -r '.error')
if [ -n "$NO_AUTH_STATUS" ] && [ "$NO_AUTH_STATUS" != "null" ]; then
  echo "Missing auth header correctly rejected"
else
  echo "WARNING: Missing auth header was not rejected"
fi
echo ""

echo "--- Step 8: Test invalid JWT is rejected for feed access ---"
INVALID_FEED=$(curl -s -H "Authorization: Bearer invalid_jwt" "$BASE_URL/api/v1/feed")
INVALID_FEED_ERROR=$(echo "$INVALID_FEED" | jq -r '.error')
if [ "$INVALID_FEED_ERROR" = "null" ] || [ -z "$INVALID_FEED_ERROR" ]; then
  echo "WARNING: Invalid JWT was not rejected"
else
  echo "Invalid JWT correctly rejected: $INVALID_FEED_ERROR"
fi
echo ""

echo "=== E2E Test Complete ==="
