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
INVALID_HTTP_CODE=$(curl -s -o /tmp/invalid_exchange.json -w "%{http_code}" -X POST "$BASE_URL/api/v1/x402/exchange" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer invalid_x402_token")
if [ "$INVALID_HTTP_CODE" = "401" ]; then
  INVALID_ERROR=$(jq -r '.error' /tmp/invalid_exchange.json 2>/dev/null)
  if [ -n "$INVALID_ERROR" ] && [ "$INVALID_ERROR" != "null" ]; then
    echo "Invalid x402 token correctly rejected (HTTP $INVALID_HTTP_CODE): $INVALID_ERROR"
  else
    echo "Invalid x402 token rejected with HTTP $INVALID_HTTP_CODE (no error detail in response)"
  fi
else
  echo "WARNING: Invalid x402 token was not rejected (HTTP $INVALID_HTTP_CODE)"
  cat /tmp/invalid_exchange.json
fi
echo ""

echo "--- Step 7: Test missing auth header is rejected by proxy ---"
NO_AUTH_HTTP_CODE=$(curl -s -o /tmp/no_auth_exchange.json -w "%{http_code}" -X POST "$BASE_URL/api/v1/x402/exchange" \
  -H "Content-Type: application/json")
if [ "$NO_AUTH_HTTP_CODE" = "401" ]; then
  NO_AUTH_ERROR=$(jq -r '.error' /tmp/no_auth_exchange.json 2>/dev/null)
  if [ -n "$NO_AUTH_ERROR" ] && [ "$NO_AUTH_ERROR" != "null" ]; then
    echo "Missing auth header correctly rejected (HTTP $NO_AUTH_HTTP_CODE): $NO_AUTH_ERROR"
  else
    echo "Missing auth header rejected with HTTP $NO_AUTH_HTTP_CODE (no error detail in response)"
  fi
else
  echo "WARNING: Missing auth header was not rejected (HTTP $NO_AUTH_HTTP_CODE)"
  cat /tmp/no_auth_exchange.json
fi
echo ""

echo "--- Step 8: Test invalid JWT is rejected for feed access ---"
INVALID_FEED_HTTP_CODE=$(curl -s -o /tmp/invalid_feed.json -w "%{http_code}" -H "Authorization: Bearer invalid_jwt" "$BASE_URL/api/v1/feed")
if [ "$INVALID_FEED_HTTP_CODE" = "401" ]; then
  INVALID_FEED_ERROR=$(jq -r '.error' /tmp/invalid_feed.json 2>/dev/null)
  if [ -n "$INVALID_FEED_ERROR" ] && [ "$INVALID_FEED_ERROR" != "null" ]; then
    echo "Invalid JWT correctly rejected (HTTP $INVALID_FEED_HTTP_CODE): $INVALID_FEED_ERROR"
  else
    echo "Invalid JWT rejected with HTTP $INVALID_FEED_HTTP_CODE (no error detail in response)"
  fi
else
  echo "WARNING: Invalid JWT was not rejected (HTTP $INVALID_FEED_HTTP_CODE)"
  cat /tmp/invalid_feed.json
fi
echo ""

echo "=== E2E Test Complete ==="
rm -f /tmp/invalid_exchange.json /tmp/no_auth_exchange.json /tmp/invalid_feed.json
