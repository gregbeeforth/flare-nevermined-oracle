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

# The full purchase flow requires a subscriber account with an enrolled payment
# card (the live plan is Stripe/card-delegation; the publisher key only holds a
# crypto wallet). When no token can be obtained the script automatically falls
# back to minting a local JWT (same algorithm/claims as the worker) and verifies
# the worker-side flow (health + JWT feed). Set PAYMENT=1 to require the real
# purchase leg and fail if it cannot complete.
PAYMENT="${PAYMENT:-0}"

if [ -z "$JWT_SECRET" ]; then
  echo "WARNING: JWT_SECRET not set in .env; the worker must have it configured"
  echo "  (local dev: JWT_SECRET=... npx wrangler dev; remote: wrangler secret put JWT_SECRET)"
  echo ""
fi

mint_local_jwt() {
  if [ -z "$JWT_SECRET" ] || [ -z "$NVM_AGENT_ID" ] || [ -z "$NVM_PLAN_ID" ]; then
    echo "ERROR: local JWT fallback requires JWT_SECRET, NVM_AGENT_ID and NVM_PLAN_ID in .env"
    return 1
  fi
  PROXY_TOKEN=$(JWT_SECRET="$JWT_SECRET" NVM_AGENT_ID="$NVM_AGENT_ID" NVM_PLAN_ID="$NVM_PLAN_ID" node -e '
    const { SignJWT } = require("jose");
    (async () => {
      const secret = new TextEncoder().encode(process.env.JWT_SECRET);
      const jwt = await new SignJWT({
        sub: process.env.NVM_AGENT_ID,
        planId: process.env.NVM_PLAN_ID,
        x402Version: "1.0",
      })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("1h")
        .sign(secret);
      console.log(jwt);
    })().catch((e) => { console.error(e); process.exit(1); });
  ')
  if [ -z "$PROXY_TOKEN" ]; then
    echo "ERROR: Failed to mint local JWT"
    return 1
  fi
  echo "JWT minted locally with JWT_SECRET (${#PROXY_TOKEN} chars)"
  echo "NOTE: Skipping the Nevermined purchase leg. The live plan requires a"
  echo "      Stripe card enrolled on a subscriber account to complete payment."
  return 0
}

run_test() {
  local BASE_URL="$1"
  local LABEL="$2"
  local EXPECT_SUB="$3"

  echo "=== E2E Test for $LABEL ($BASE_URL) ==="

  echo "--- Step 1: Health Check ---"
  HEALTH=$(curl -s "$BASE_URL/health")
  echo "$HEALTH" | python3 -m json.tool
  echo ""

  if [ "$PAYMENT" = "1" ]; then
    echo "--- Step 2: Get x402 Token (PAYMENT=1) ---"
    if [ -n "$NVM_API_KEY" ] && [ -n "$NVM_PLAN_ID" ] && [ -n "$NVM_AGENT_ID" ]; then
      if ! X402_TOKEN=$(NVM_API_KEY="$NVM_API_KEY" NVM_PLAN_ID="$NVM_PLAN_ID" NVM_AGENT_ID="$NVM_AGENT_ID" node get-x402-token.mjs 2>/tmp/x402-token.err); then
        echo "ERROR: Failed to get x402 token from Nevermined"
        cat /tmp/x402-token.err
        echo ""
        echo "! The full purchase flow requires an active payment method for the plan."
        echo "! The live plan is Stripe/card-delegation, so a subscriber account with an"
        echo "! enrolled card is needed."
        return 1
      fi
      echo "x402 token obtained from Nevermined (${#X402_TOKEN} chars)"
    else
      echo "ERROR: NVM_API_KEY / NVM_PLAN_ID / NVM_AGENT_ID missing"
      echo "! The exchange endpoint now verifies x402 tokens against the Nevermined backend."
      echo "! Set NVM_API_KEY, NVM_PLAN_ID and NVM_AGENT_ID in .env to run the payment flow."
      return 1
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
  else
    echo "--- Step 2: Get x402 Token ---"
    if [ -n "$NVM_API_KEY" ] && [ -n "$NVM_PLAN_ID" ] && [ -n "$NVM_AGENT_ID" ]; then
      if X402_TOKEN=$(NVM_API_KEY="$NVM_API_KEY" NVM_PLAN_ID="$NVM_PLAN_ID" NVM_AGENT_ID="$NVM_AGENT_ID" node get-x402-token.mjs 2>/tmp/x402-token.err); then
        echo "x402 token obtained from Nevermined (${#X402_TOKEN} chars)"
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
      else
        echo "WARNING: Failed to get x402 token from Nevermined; falling back to a local JWT."
        echo "  (full purchase requires a subscriber payment card)"
        cat /tmp/x402-token.err
        echo ""
        mint_local_jwt || return 1
      fi
    else
      echo "WARNING: NVM_API_KEY / NVM_PLAN_ID / NVM_AGENT_ID not fully set; falling back to a local JWT."
      mint_local_jwt || return 1
    fi
  fi

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
