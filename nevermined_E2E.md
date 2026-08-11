# End-to-End Testing Plan — Nevermined Sandbox

This plan covers testing the full payment pipeline on the Nevermined sandbox: purchase → x402 token → JWT → feed access, using both the **Nevermined CLI** and the deployed SnapDeploy proxy.

## Current Sandbox Setup (2026-08)

| Item | Value |
|------|-------|
| Plan | `90213210181926588284985312438743862799329168587531621679082591145535338059798` — "Premium" |
| Scheme | `nvm:card-delegation` (**fiat**) |
| Agent | `110713508537973181677785424688917426688646561931642623112002162389088377785627` — "FTSO Oracle" |
| Proxy | `https://nevermined-oracle-7c351.containers.snapdeploy.app` |
| Subscriber | `0x09D8DaB827006510a00Fb7085b49C3a43139311e` |
| Enrolled card | visa `****4242` (`pm_1U2pU7Ph60bb0BjN7KtVdj7G`) |

> **Scheme caveat:** this plan is **fiat** (`nvm:card-delegation`). The helper
> `get-x402-token.mjs` uses the crypto `erc4337` scheme and will **not** work
> for it — use `get-x402-token-fiat.mjs` instead. The CLI's
> `x402token get-x402-access-token --payment-type fiat` also currently fails
> (HTTP 402) because inline delegation creation was removed from the backend;
> the SDK's create-first flow (used by `get-x402-token-fiat.mjs`) is required.

## Prerequisites

- Nevermined sandbox account with an active Flare FTSO Oracle Feed agent
- API deployed to SnapDeploy at `https://nevermined-oracle-7c351.containers.snapdeploy.app`
- Sandbox credentials in `.env`: `NVM_API_KEY`, `NVM_PLAN_ID`, `NVM_AGENT_ID`, `JWT_SECRET`
- `nevermined` CLI installed and configured (`nevermined config show` shows a `sandbox:` API key)
- Helper scripts present: `get-x402-token-fiat.mjs`, `build-payment-required.mjs`
- SnapDeploy containers sleep after inactivity — first request after idle takes **60-90s** (HTTP 503/wake page). The steps below tolerate this; `test-e2e.sh` retries automatically.

## Phase 0: Pre-Flight Checks

| # | Check | Command / Action | Expected Result |
|---|-------|-----------------|-----------------|
| 0.1 | CLI is authenticated | `nevermined config show` | Profile `default`, `nvmApiKey` starts with `sandbox:` |
| 0.2 | `.env` has sandbox credentials | Confirm `NVM_API_KEY` starts with `sandbox:`, `NVM_PLAN_ID` and `NVM_AGENT_ID` are set | All values present |
| 0.3 | Proxy is live | `curl https://nevermined-oracle-7c351.containers.snapdeploy.app/health` | `{"status":"ok",...}` (retry 60-90s if sleeping) |
| 0.4 | Plan exists and is active | `nevermined plans get-plan $NVM_PLAN_ID` | Plan `Premium` active with credits |

## Phase 1: Verify the Purchase via CLI

| # | Step | Command | Expected Result |
|---|------|---------|-----------------|
| 1.1 | Check plan balance | `nevermined plans get-plan-balance $NVM_PLAN_ID -f json` | `balance > 0`, `isSubscriber: true`, holder is your address |
| 1.2 | Check agent linkage | `nevermined plans get-agents-associated-to-a-plan $NVM_PLAN_ID -f json` | Returns the FTSO Oracle agent |
| 1.3 | Check enrolled card | `nevermined delegation list-payment-methods -f json` | A `card` entry (e.g. visa `****4242`) is present |

## Phase 2: x402 Token Generation (fiat)

| # | Step | Command | Expected Result |
|---|------|---------|-----------------|
| 2.1 | Generate x402 token (fiat) | `X402_TOKEN=$(node get-x402-token-fiat.mjs)` | Prints a long base64url string (the x402 access token) |
| 2.2 | Inspect token claims | Decode the token (base64url-encoded JSON) | `accepted.planId` and `accepted.extra.agentId` match `.env`; `accepted.scheme` is `nvm:card-delegation` |
| 2.3 | CLI attempt (currently broken) | `nevermined x402token get-x402-access-token $NVM_PLAN_ID --agent-id $NVM_AGENT_ID --payment-type fiat` | Fails with `HTTP 402` — inline delegation creation removed; use step 2.1 |

## Phase 3: Facilitator Verification via CLI (no credit burn)

The proxy calls `payments.facilitator.verifyPermissions()` before issuing a JWT.
You can replicate that check directly from the CLI without touching the proxy.

| # | Step | Command | Expected Result |
|---|------|---------|-----------------|
| 3.1 | Build `paymentRequired` JSON | `PR=$(node build-payment-required.mjs)` | JSON containing `accepts[0].planId` and `extra.agentId` |
| 3.2 | Verify permissions (no burn) | `nevermined facilitator verify-permissions --params "{\"paymentRequired\":$PR,\"x402AccessToken\":\"$X402_TOKEN\"}" -f json` | `isValid: true`, plan balance shown |
| 3.3 | Settle permissions (burns credits) | Same as 3.2 with `settle-permissions` | `success: true`, balance decremented (only when you want to burn) |

## Phase 4: x402 → JWT Exchange (SnapDeploy Proxy with Payment Verification)

| # | Step | Command | Expected Result |
|---|------|---------|-----------------|
| 4.1 | Exchange x402 token for JWT | `PROXY_TOKEN=$(curl -s -X POST https://nevermined-oracle-7c351.containers.snapdeploy.app/api/v1/x402/exchange -H "Content-Type: application/json" -H "Authorization: Bearer $X402_TOKEN" \| jq -r '.token')` | `PROXY_TOKEN` is a non-empty JWT string |
| 4.2 | Verify JWT structure | Decode the JWT header/payload | `sub` is the agent ID, `planId` matches, `exp` is ~1 hour in the future |
| 4.3 | Test with invalid x402 token | `curl -s -X POST https://nevermined-oracle-7c351.containers.snapdeploy.app/api/v1/x402/exchange -H "Authorization: Bearer invalid_token"` | 401 with `x402 token verification failed: ...` |
| 4.4 | Test without auth header | `curl -s -X POST https://nevermined-oracle-7c351.containers.snapdeploy.app/api/v1/x402/exchange -H "Content-Type: application/json"` | 401 with "Missing or malformed Authorization header" |

## Phase 5: Feed Access via JWT

| # | Step | Command | Expected Result |
|---|------|---------|-----------------|
| 5.1 | Query feed with valid JWT | `curl -s -H "Authorization: Bearer $PROXY_TOKEN" https://nevermined-oracle-7c351.containers.snapdeploy.app/api/v1/feed` | `{"success":true,"data":{"feeds":[...],"blockHeight":...,"networkTimestamp":...}}` |
| 5.2 | Verify feed data | Check `feeds` for the FTSO feed IDs in `.env` (`0x01464c52...` FLR/USD and `0x01425443...` BTC/USD) | Feed values numeric, timestamps recent |
| 5.3 | Test with expired/invalid JWT | `curl -s -H "Authorization: Bearer invalid_jwt" https://nevermined-oracle-7c351.containers.snapdeploy.app/api/v1/feed` | 401 with "Invalid or expired token" |
| 5.4 | Test without JWT | `curl -s https://nevermined-oracle-7c351.containers.snapdeploy.app/api/v1/feed` | 401 with "Missing or malformed Authorization header" |

## Phase 6: Full Flow Integration (All Steps Combined)

| # | Step | Command | Expected Result |
|---|------|---------|-----------------|
| 6.1 | Run the full E2E script | `./test-e2e.sh` | All steps pass; feed data with `success: true` |
| 6.2 | Run manually as one line | `X402_TOKEN=$(node get-x402-token-fiat.mjs) && PROXY_TOKEN=$(curl -s -X POST https://nevermined-oracle-7c351.containers.snapdeploy.app/api/v1/x402/exchange -H "Content-Type: application/json" -H "Authorization: Bearer $X402_TOKEN" \| jq -r '.token') && curl -s -H "Authorization: Bearer $PROXY_TOKEN" https://nevermined-oracle-7c351.containers.snapdeploy.app/api/v1/feed \| python3 -m json.tool` | Valid feed data with `success: true` |
| 6.3 | Verify proxy payment verification | The proxy calls `payments.facilitator.verifyPermissions()` before issuing a JWT | Invalid or unverified tokens rejected with 401 |
| 6.4 | Repeat to test token expiry | Wait for the JWT to expire (1h), then repeat 6.2 | Feed access fails with 401 |
| 6.5 | Test cold start | Wait 10+ minutes for the SnapDeploy container to sleep, then run 6.1 | First request takes 10-90s (wake), subsequent are fast |

## Phase 7: Edge Cases & Error Handling

| # | Scenario | How to Test | Expected Result |
|---|----------|-------------|----------------|
| 7.1 | Expired x402 token | Use an old x402 token (if available) | Exchange returns 401 or 403 |
| 7.2 | Wrong plan ID | Set `NVM_PLAN_ID` to an invalid value in `.env` | `get-x402-token-fiat.mjs` fails with 401 |
| 7.3 | Wrong agent ID | Set `NVM_AGENT_ID` to an invalid value | Token minted but proxy exchange returns 401 (agent mismatch) |
| 7.4 | Missing env vars | Remove `NVM_API_KEY` and run `get-x402-token-fiat.mjs` | Script fails with "Nevermined API Key is required" |
| 7.5 | CLI fiat token path | Run step 2.3 | HTTP 402 (known CLI bug) — confirms helper is required |
| 7.6 | JWT_SECRET mismatch | Change `JWT_SECRET` in `.env` without redeploying | Feed access fails with 401 even with valid proxy token |

## Phase 8: Production Readiness Checklist

| # | Check | Action |
|---|-------|--------|
| 8.1 | Switch to live credentials | Update `.env` with `live:` API key, live plan ID, live agent ID |
| 8.2 | Set `NODE_ENV=production` | Update SnapDeploy environment variables |
| 8.3 | Use mainnet RPC and feed IDs | Update `FLARE_RPC_URL` and `FTSO_FEED_IDS` |
| 8.4 | Use production wallet | Update `RECEIVER_ADDRESS` |
| 8.5 | Test on mainnet | Repeat Phases 1-6 with live credentials |

## Quick-Start: Minimal Test Commands

```bash
# 0. Health check (wake takes 60-90s if the container is asleep)
curl https://nevermined-oracle-7c351.containers.snapdeploy.app/health

# 1. Verify the purchase via CLI
nevermined plans get-plan-balance "$NVM_PLAN_ID"
nevermined plans get-agents-associated-to-a-plan "$NVM_PLAN_ID"

# 2. Get x402 token (fiat / card-delegation — NOT get-x402-token.mjs)
X402_TOKEN=$(node get-x402-token-fiat.mjs)

# 3. Verify permissions via CLI (no burn)
PR=$(node build-payment-required.mjs)
nevermined facilitator verify-permissions \
  --params "{\"paymentRequired\":$PR,\"x402AccessToken\":\"$X402_TOKEN\"}"

# 4. Exchange for JWT via the proxy
PROXY_TOKEN=$(curl -s -X POST https://nevermined-oracle-7c351.containers.snapdeploy.app/api/v1/x402/exchange \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $X402_TOKEN" | jq -r '.token')

# 5. Query the feed
curl -H "Authorization: Bearer $PROXY_TOKEN" https://nevermined-oracle-7c351.containers.snapdeploy.app/api/v1/feed
```
