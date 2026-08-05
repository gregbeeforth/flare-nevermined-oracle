#!/bin/bash
set -e

echo "=== Flare Nevermined Oracle E2E Test ==="
echo ""

set -a
source .env
set +a

BASE_URL="https://nevermined-oracle-7c351.containers.snapdeploy.app"

function is_json() {
  echo "$1" | python3 -m json.tool > /dev/null 2>&1
}

function check_server() {
  local url="$1"
  local max_retries=3
  local retry=0
  while [ $retry -lt $max_retries ]; do
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
    if [ "$http_code" = "200" ] || [ "$http_code" = "401" ]; then
      return 0
    fi
    retry=$((retry + 1))
    echo "  Retrying ($retry/$max_retries)..."
    sleep 5
  done
  return 1
}

echo "--- Step 1: Health Check ---"
if ! check_server "$BASE_URL/health"; then
  echo "ERROR: Server is not reachable (HTTP 520 or timeout). Is SnapDeploy container running?"
  echo "  Try: curl -s -o /dev/null -w '%{http_code}' $BASE_URL/health"
  exit 1
fi
HEALTH=$(curl -s "$BASE_URL/health")
if ! is_json "$HEALTH"; then
  echo "ERROR: Health check did not return JSON. Got:"
  echo "$HEALTH"
  exit 1
fi
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
EXCHANGE_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/v1/x402/exchange" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $X402_TOKEN" || echo "000")
EXCHANGE_HTTP_CODE=$(echo "$EXCHANGE_RESP" | tail -1)
EXCHANGE_BODY=$(echo "$EXCHANGE_RESP" | sed '$d')

if [ "$EXCHANGE_HTTP_CODE" = "000" ]; then
  echo "ERROR: Connection failed. Is SnapDeploy container running?"
  exit 1
fi

if [ "$EXCHANGE_HTTP_CODE" != "200" ]; then
  echo "ERROR: Exchange returned HTTP $EXCHANGE_HTTP_CODE"
  echo "$EXCHANGE_BODY" | python3 -m json.tool 2>/dev/null || echo "$EXCHANGE_BODY"
  exit 1
fi

PROXY_TOKEN=$(echo "$EXCHANGE_BODY" | jq -r '.token')
if [ -z "$PROXY_TOKEN" ] || [ "$PROXY_TOKEN" = "null" ]; then
  echo "ERROR: Failed to exchange x402 token for JWT"
  exit 1
fi
echo "JWT obtained (${#PROXY_TOKEN} chars)"
echo ""

echo "--- Step 4: Query Feed with JWT ---"
FEED_RESP=$(curl -s -w "\n%{http_code}" -H "Authorization: Bearer $PROXY_TOKEN" "$BASE_URL/api/v1/feed" || echo "000")
FEED_HTTP_CODE=$(echo "$FEED_RESP" | tail -1)
FEED_BODY=$(echo "$FEED_RESP" | sed '$d')

if [ "$FEED_HTTP_CODE" = "000" ]; then
  echo "ERROR: Connection failed. Is SnapDeploy container running?"
  exit 1
fi

if [ "$FEED_HTTP_CODE" != "200" ]; then
  echo "ERROR: Feed request returned HTTP $FEED_HTTP_CODE"
  echo "$FEED_BODY" | python3 -m json.tool 2>/dev/null || echo "$FEED_BODY"
  exit 1
fi

echo "$FEED_BODY" | python3 -m json.tool
echo ""

echo "--- Step 5: Verify feed data structure ---"
FEED_SUCCESS=$(echo "$FEED_BODY" | jq -r '.success')
FEED_DATA=$(echo "$FEED_BODY" | jq -r '.data')
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
INVALID_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/v1/x402/exchange" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer invalid_x402_token" || echo "000")
INVALID_HTTP_CODE=$(echo "$INVALID_RESP" | tail -1)
INVALID_BODY=$(echo "$INVALID_RESP" | sed '$d')

if [ "$INVALID_HTTP_CODE" = "401" ]; then
  INVALID_ERROR=$(echo "$INVALID_BODY" | jq -r '.error' 2>/dev/null)
  echo "Invalid x402 token correctly rejected (HTTP 401): ${INVALID_ERROR:-no detail}"
elif [ "$INVALID_HTTP_CODE" = "000" ]; then
  echo "WARNING: Connection failed (server may be down)"
else
  echo "WARNING: Invalid x402 token was not rejected (HTTP $INVALID_HTTP_CODE)"
  echo "$INVALID_BODY" | python3 -m json.tool 2>/dev/null || echo "$INVALID_BODY"
fi
echo ""

echo "--- Step 7: Test missing auth header is rejected by proxy ---"
NO_AUTH_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/v1/x402/exchange" \
  -H "Content-Type: application/json" || echo "000")
NO_AUTH_HTTP_CODE=$(echo "$NO_AUTH_RESP" | tail -1)
NO_AUTH_BODY=$(echo "$NO_AUTH_RESP" | sed '$d')

if [ "$NO_AUTH_HTTP_CODE" = "401" ]; then
  NO_AUTH_ERROR=$(echo "$NO_AUTH_BODY" | jq -r '.error' 2>/dev/null)
  echo "Missing auth header correctly rejected (HTTP 401): ${NO_AUTH_ERROR:-no detail}"
elif [ "$NO_AUTH_HTTP_CODE" = "000" ]; then
  echo "WARNING: Connection failed (server may be down)"
else
  echo "WARNING: Missing auth header was not rejected (HTTP $NO_AUTH_HTTP_CODE)"
  echo "$NO_AUTH_BODY" | python3 -m json.tool 2>/dev/null || echo "$NO_AUTH_BODY"
fi
echo ""

echo "--- Step 8: Test invalid JWT is rejected for feed access ---"
INVALID_FEED_RESP=$(curl -s -w "\n%{http_code}" -H "Authorization: Bearer invalid_jwt" "$BASE_URL/api/v1/feed" || echo "000")
INVALID_FEED_HTTP_CODE=$(echo "$INVALID_FEED_RESP" | tail -1)
INVALID_FEED_BODY=$(echo "$INVALID_FEED_RESP" | sed '$d')

if [ "$INVALID_FEED_HTTP_CODE" = "401" ]; then
  INVALID_FEED_ERROR=$(echo "$INVALID_FEED_BODY" | jq -r '.error' 2>/dev/null)
  echo "Invalid JWT correctly rejected (HTTP 401): ${INVALID_FEED_ERROR:-no detail}"
elif [ "$INVALID_FEED_HTTP_CODE" = "000" ]; then
  echo "WARNING: Connection failed (server may be down)"
else
  echo "WARNING: Invalid JWT was not rejected (HTTP $INVALID_FEED_HTTP_CODE)"
  echo "$INVALID_FEED_BODY" | python3 -m json.tool 2>/dev/null || echo "$INVALID_FEED_BODY"
fi
echo ""

echo "=== E2E Test Complete ==="