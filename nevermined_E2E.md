# End-to-End Testing Plan — Nevermined Sandbox

This plan covers testing the full payment pipeline on the Nevermined sandbox: purchase → x402 token → JWT → feed access.

## Prerequisites

- Nevermined sandbox account with an active Flare FTSO Oracle Feed agent
- API deployed to SnapDeploy at `https://nevermined-oracle-7c351.containers.snapdeploy.app`
- Sandbox credentials in `.env`: `NVM_API_KEY`, `NVM_PLAN_ID`, `NVM_AGENT_ID`, `JWT_SECRET`

## Phase 0: Pre-Flight Checks

| # | Check | Command / Action | Expected Result |
|---|-------|-----------------|-----------------|
| 0.1 | Verify SnapDeploy is live | `curl https://nevermined-oracle-7c351.containers.snapdeploy.app/health` | `{"status":"ok","timestamp":"..."}` |
| 0.2 | Verify `.env` has sandbox credentials | Confirm `NVM_API_KEY` starts with `sandbox:`, `NVM_PLAN_ID` and `NVM_AGENT_ID` are set | All values present |
| 0.3 | Verify the agent is active | Log into [nevermined.app](https://nevermined.app) → **Agents** → confirm Flare FTSO Oracle Feed agent is active and proxy URL is `https://nevermined-oracle-7c351.containers.snapdeploy.app` | Agent active, proxy URL correct |
| 0.4 | Verify the plan exists | In the Nevermined dashboard, confirm plan ID `40743688611427105982248667827622520342780227742182160007037770161859192304254` is active and has credits | Plan active with available credits |

## Phase 1: Local x402 Token Generation

| # | Step | Command | Expected Result |
|---|------|---------|-----------------|
| 1.1 | Generate x402 token locally | `NVM_API_KEY=... NVM_PLAN_ID=... NVM_AGENT_ID=... node get-x402-token.mjs` | Outputs a long base64url string (the x402 access token) |
| 1.2 | Save token to env var | `X402_TOKEN=$(node get-x402-token.mjs)` | `$X402_TOKEN` is non-empty |
| 1.3 | Inspect token contents | Decode the token (base64url-encoded JSON) and verify `accepted.planId` and `accepted.extra.agentId` match your values | Claims match `.env` values |

## Phase 2: x402 → JWT Exchange (SnapDeploy Proxy with Payment Verification)

| # | Step | Command | Expected Result |
|---|------|---------|-----------------|
| 2.1 | Exchange x402 token for JWT via SnapDeploy | `PROXY_TOKEN=$(curl -s -X POST https://nevermined-oracle-7c351.containers.snapdeploy.app/api/v1/x402/exchange -H "Content-Type: application/json" -H "Authorization: Bearer $X402_TOKEN" \| jq -r '.token')` | `PROXY_TOKEN` is a non-empty JWT string |
| 2.2 | Verify JWT structure | Decode the JWT header/payload and check `sub` contains the agent ID, `planId` matches, `exp` is ~1 hour in the future | Claims are correct and token is time-bound |
| 2.3 | Test with invalid x402 token | `curl -s -X POST https://nevermined-oracle-7c351.containers.snapdeploy.app/api/v1/x402/exchange -H "Authorization: Bearer invalid_token"` | Returns `{"success":false,"error":"x402 token verification failed: ..."}` with 401 |
| 2.4 | Test without auth header | `curl -s -X POST https://nevermined-oracle-7c351.containers.snapdeploy.app/api/v1/x402/exchange -H "Content-Type: application/json"` | Returns 401 with "Missing or malformed Authorization header" |
| 2.5 | Verify proxy checks payment with Nevermined facilitator | The proxy calls `payments.facilitator.verifyPermissions()` before issuing a JWT, confirming the x402 token is backed by a real Nevermined purchase | Invalid or unverified tokens are rejected with 401 |

## Phase 3: Feed Access via JWT

| # | Step | Command | Expected Result |
|---|------|---------|-----------------|
| 3.1 | Query feed with valid JWT | `curl -s -H "Authorization: Bearer $PROXY_TOKEN" https://nevermined-oracle-7c351.containers.snapdeploy.app/api/v1/feed` | Returns `{"success":true,"data":{"feeds":[...],"blockHeight":...,"networkTimestamp":...}}` |
| 3.2 | Verify feed data | Check that `feeds` contains entries for the FTSO feed IDs in `.env` (`0x01464c52...` and `0x01425443...`) | Feed values are numeric, timestamps are recent |
| 3.3 | Test with expired/invalid JWT | `curl -s -H "Authorization: Bearer invalid_jwt" https://nevermined-oracle-7c351.containers.snapdeploy.app/api/v1/feed` | Returns 401 with "Invalid or expired token" |
| 3.4 | Test without JWT | `curl -s https://nevermined-oracle-7c351.containers.snapdeploy.app/api/v1/feed` | Returns 401 with "Missing or malformed Authorization header" |

## Phase 4: Full Flow Integration (All Steps Combined)

| # | Step | Command | Expected Result |
|---|------|---------|-----------------|
| 4.1 | Run the full flow script | ```bash X402_TOKEN=$(node get-x402-token.mjs) && PROXY_TOKEN=$(curl -s -X POST https://nevermined-oracle-7c351.containers.snapdeploy.app/api/v1/x402/exchange -H "Content-Type: application/json" -H "Authorization: Bearer $X402_TOKEN" \| jq -r '.token') && curl -s -H "Authorization: Bearer $PROXY_TOKEN" https://nevermined-oracle-7c351.containers.snapdeploy.app/api/v1/feed \| python3 -m json.tool ``` | Returns valid feed data with `success: true` |
| 4.2 | Verify proxy payment verification | The proxy calls `payments.facilitator.verifyPermissions()` before issuing a JWT, confirming the x402 token is backed by a real Nevermined purchase | Invalid or unverified tokens are rejected with 401 |
| 4.3 | Repeat to test token expiry | Wait for the JWT to expire (or use a short-lived token), then repeat step 4.1 | Feed access fails with 401, confirming JWT expiry works |
| 4.4 | Test cold start | Wait 10+ minutes for the SnapDeploy container to sleep, then run step 4.1 | First request may take 10-30s (cold start), subsequent requests are fast |

## Phase 5: Edge Cases & Error Handling

| # | Scenario | How to Test | Expected Result |
|---|----------|-------------|-----------------|
| 5.1 | Expired x402 token | Use an old x402 token (if available) | Exchange returns 401 or 403 |
| 5.2 | Wrong plan ID | Set `NVM_PLAN_ID` to an invalid value in `.env` | `getX402AccessToken` fails with 401 |
| 5.3 | Wrong agent ID | Set `NVM_AGENT_ID` to an invalid value | `getX402AccessToken` fails or returns token without proper claims |
| 5.4 | Missing env vars | Remove `NVM_API_KEY` and run `get-x402-token.mjs` | Script fails with "Nevermined API Key is required" |
| 5.5 | Unsupported chain ID | Set `NEVERMINED_PAYMENT_CHAIN` to a wrong value | Payment flow fails at checkout |
| 5.6 | JWT_SECRET mismatch | Change `JWT_SECRET` in `.env` without redeploying | Feed access fails with 401 even with valid proxy token |

## Phase 6: Nevermined Agent Verification

| # | Step | Action | Expected Result |
|---|------|--------|-----------------|
| 6.1 | Check agent logs | In nevermined.app → **Agents** → your Flare FTSO Oracle Feed agent → **Logs** | Logs show successful payment verification and feed access |
| 6.2 | Check credit consumption | In nevermined.app → **Agents** → your agent → **Plans** | Credits are being deducted from the plan |
| 6.3 | Verify proxy URL | In nevermined.app → **Agents** → your agent → **Settings** | Proxy URL is `https://nevermined-oracle-7c351.containers.snapdeploy.app` |

## Phase 7: Production Readiness Checklist

| # | Check | Action |
|---|-------|--------|
| 7.1 | Switch to live credentials | Update `.env` with `live:` API key, live plan ID, live agent ID |
| 7.2 | Set `NODE_ENV=production` | Update SnapDeploy environment variables |
| 7.3 | Use mainnet RPC and feed IDs | Update `FLARE_RPC_URL` and `FTSO_FEED_IDS` |
| 7.4 | Use production wallet | Update `RECEIVER_ADDRESS` |
| 7.5 | Test on mainnet | Repeat Phase 2-4 with live credentials |

## Quick-Start: Minimal Test Commands

```bash
# 1. Health check
curl https://nevermined-oracle-7c351.containers.snapdeploy.app/health

# 2. Get x402 token
X402_TOKEN=$(NVM_API_KEY="$NVM_API_KEY" NVM_PLAN_ID="$NVM_PLAN_ID" NVM_AGENT_ID="$NVM_AGENT_ID" node get-x402-token.mjs)

# 3. Exchange for JWT
PROXY_TOKEN=$(curl -s -X POST https://nevermined-oracle-7c351.containers.snapdeploy.app/api/v1/x402/exchange \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $X402_TOKEN" | jq -r '.token')

# 4. Query the feed
curl -H "Authorization: Bearer $PROXY_TOKEN" https://nevermined-oracle-7c351.containers.snapdeploy.app/api/v1/feed
```