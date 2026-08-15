# Testing — flare-nevermined-oracle

This covers the automated test layers and the manual end-to-end payment flow on the Nevermined sandbox: purchase → x402 token → JWT → feed access.

## Automated Tests

```bash
npm test              # All tests (unit + integration, requires network access to Coston2)
npm run test:integration  # Integration tests only (FlareConsumer + server, real Coston2 RPC)
npm run test:e2e        # E2E tests only (Hono app + real Flare data via app.request())
```

| Test Type | Command | What it verifies |
|---|---|---|
| Unit | `npx jest --testPathPattern=flareConsumer.test` / `jwtAuth.test` / `x402Exchange.test` | Mocked, fast tests; no network calls |
| Integration | `npm run test:integration` | `FlareConsumer` against the real Coston2 testnet (contract resolution + live FTSO feeds) |
| E2E | `npm run test:e2e` | Full HTTP request/response cycle via `app.request()`, including JWT auth and real Flare data |

`npm test` runs all `**/*.test.ts` files, which includes both unit and integration tests.

### Prerequisites for Integration/E2E Tests

- A working internet connection to reach `coston2-api.flare.network`
- `.env` with `FLARE_RPC_URL=https://coston2-api.flare.network/ext/C/rpc`
- `JWT_SECRET` set (used for E2E JWT generation)
- `TEST_RPC_URL` / `TEST_CHAIN_ID` can override the default RPC (e.g. `114` for Coston2, `14` for Flare mainnet)

## Manual Curl Testing

Generate a test JWT and manually test the endpoints:

```bash
# Generate a JWT
TOKEN=$(node -e "const { SignJWT } = require('jose'); const s = new TextEncoder().encode(process.env.JWT_SECRET); SignJWT({sub:'test'}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(s).then(t => console.log(t))")

# Test health endpoint (no auth needed)
curl http://localhost:8787/health

# Test feed endpoint (requires JWT)
curl -H "Authorization: Bearer $TOKEN" http://localhost:8787/api/v1/feed
```

## E2E Script

`test-e2e-worker.sh` automates the full flow against the deployed worker:

```bash
./test-e2e-worker.sh
```

- Runs against `https://flare-nevermined-oracle.flare-oracle.workers.dev` by default (override with `REMOTE_URL=...`)
- Optionally also tests a local `wrangler dev` instance (`RUN_LOCAL=1`, `LOCAL_URL=...`)
- Verifies the exchanged JWT's `sub` claim matches `NVM_AGENT_ID`

## Manual E2E Flow (Nevermined Sandbox)

### Prerequisites

- Nevermined sandbox account with an active Flare FTSO Oracle Feed agent
- API deployed to Cloudflare Workers at `https://flare-nevermined-oracle.flare-oracle.workers.dev`
- Sandbox credentials in `.env`: `NVM_API_KEY`, `NVM_PLAN_ID`, `NVM_AGENT_ID`, `JWT_SECRET`

### Phase 0: Pre-Flight Checks

| # | Check | Command / Action | Expected Result |
|---|-------|-----------------|-----------------|
| 0.1 | Verify the Cloudflare Worker is live | `curl https://flare-nevermined-oracle.flare-oracle.workers.dev/health` | `{"status":"ok","timestamp":"..."}` |
| 0.2 | Verify `.env` has sandbox credentials | Confirm `NVM_API_KEY` starts with `sandbox:`, `NVM_PLAN_ID` and `NVM_AGENT_ID` are set | All values present |
| 0.3 | Verify the agent is active | Log into [nevermined.app](https://nevermined.app) → **Agents** → confirm Flare FTSO Oracle Feed agent is active and proxy URL is `https://flare-nevermined-oracle.flare-oracle.workers.dev` | Agent active, proxy URL correct |
| 0.4 | Verify the plan exists | In the Nevermined dashboard, confirm the plan ID from `.env` (`NVM_PLAN_ID`) is active and has credits | Plan active with available credits |

### Phase 1: Local x402 Token Generation

For a **fiat (Stripe) plan**, `get-x402-token.mjs` creates a card delegation using your enrolled Stripe card. **Prerequisite:** add a payment card in the [Nevermined App](https://nevermined.app) (Settings → Payment methods). For a crypto plan it uses an erc4337 USDC delegation instead.

> The card must belong to a **subscriber** account — the account that *pays* the agent's plan. A publisher agent's Stripe account only *receives* payments and cannot mint a token for its own plan. To exercise the purchase flow, create a separate Nevermined account, add a card, subscribe to the agent's plan, and use that account's `NVM_API_KEY` (via `NVM_SUBSCRIBER_API_KEY` or by swapping it into `.env`).

| # | Step | Command | Expected Result |
|---|------|---------|-----------------|
| 1.1 | Generate x402 token locally | `NVM_API_KEY=... NVM_PLAN_ID=... NVM_AGENT_ID=... node get-x402-token.mjs` | Outputs a long base64url string (the x402 access token) |
| 1.2 | Save token to env var | `X402_TOKEN=$(node get-x402-token.mjs)` | `$X402_TOKEN` is non-empty |
| 1.3 | Inspect token contents | Decode the token (base64url-encoded JSON) and verify `accepted.planId` and `accepted.extra.agentId` match your values | Claims match `.env` values |

### Phase 2: x402 → JWT Exchange (Cloudflare Worker)

| # | Step | Command | Expected Result |
|---|------|---------|-----------------|
| 2.1 | Exchange x402 token for JWT via the Worker | `PROXY_TOKEN=$(curl -s -X POST https://flare-nevermined-oracle.flare-oracle.workers.dev/api/v1/x402/exchange -H "Content-Type: application/json" -H "Authorization: Bearer $X402_TOKEN" \| jq -r '.token')` | `PROXY_TOKEN` is a non-empty JWT string |
| 2.2 | Verify JWT structure | Decode the JWT header/payload and check `sub` contains the agent ID, `planId` matches, `exp` is ~1 hour in the future | Claims are correct and token is time-bound |
| 2.3 | Test with invalid token | `curl -s -X POST https://flare-nevermined-oracle.flare-oracle.workers.dev/api/v1/x402/exchange -H "Authorization: Bearer invalid_token"` | Returns `{"success":false,"error":"Invalid x402 token"}` with 401 |
| 2.4 | Test without auth header | `curl -s -X POST https://flare-nevermined-oracle.flare-oracle.workers.dev/api/v1/x402/exchange -H "Content-Type: application/json"` | Returns 401 with "Missing or malformed Authorization header" |

### Phase 3: Feed Access via JWT

| # | Step | Command | Expected Result |
|---|------|---------|-----------------|
| 3.1 | Query feed with valid JWT | `curl -s -H "Authorization: Bearer $PROXY_TOKEN" https://flare-nevermined-oracle.flare-oracle.workers.dev/api/v1/feed` | Returns `{"success":true,"data":{"feeds":[...],"blockHeight":...,"networkTimestamp":...}}` |
| 3.2 | Verify feed data | Check that `feeds` contains entries for the FTSO feed IDs in `.env` (`0x01464c52...` and `0x01425443...`) | Feed values are numeric, timestamps are recent |
| 3.3 | Test with expired/invalid JWT | `curl -s -H "Authorization: Bearer invalid_jwt" https://flare-nevermined-oracle.flare-oracle.workers.dev/api/v1/feed` | Returns 401 with "Invalid or expired token" |
| 3.4 | Test without JWT | `curl -s https://flare-nevermined-oracle.flare-oracle.workers.dev/api/v1/feed` | Returns 401 with "Missing or malformed Authorization header" |

### Phase 4: Full Flow Integration

| # | Step | Command | Expected Result |
|---|------|---------|-----------------|
| 4.1 | Run the full flow | `X402_TOKEN=$(node get-x402-token.mjs) && PROXY_TOKEN=$(curl -s -X POST https://flare-nevermined-oracle.flare-oracle.workers.dev/api/v1/x402/exchange -H "Content-Type: application/json" -H "Authorization: Bearer $X402_TOKEN" \| jq -r '.token') && curl -s -H "Authorization: Bearer $PROXY_TOKEN" https://flare-nevermined-oracle.flare-oracle.workers.dev/api/v1/feed \| python3 -m json.tool` | Returns valid feed data with `success: true` |
| 4.2 | Test token expiry | Wait for the JWT to expire (or use a short-lived token), then repeat step 4.1 | Feed access fails with 401, confirming JWT expiry works |
| 4.3 | Test cold start | Wait for the Worker to spin down (or run against a fresh isolate), then run step 4.1 | First request may take a few seconds longer (cold start), subsequent requests are fast |

### Phase 5: Edge Cases & Error Handling

| # | Scenario | How to Test | Expected Result |
|---|----------|-------------|-----------------|
| 5.1 | Expired x402 token | Use an old x402 token (if available) | Exchange returns 401 or 403 |
| 5.2 | Wrong plan ID | Set `NVM_PLAN_ID` to an invalid value in `.env` | `getX402AccessToken` fails with 401 |
| 5.3 | Wrong agent ID | Set `NVM_AGENT_ID` to an invalid value | `getX402AccessToken` fails or returns token without proper claims |
| 5.4 | Missing env vars | Remove `NVM_API_KEY` and run `get-x402-token.mjs` | Script fails with "Nevermined API Key is required" |
| 5.5 | Unsupported chain ID | Set `NEVERMINED_PAYMENT_CHAIN` to a wrong value | Payment flow fails at checkout |
| 5.6 | JWT_SECRET mismatch | Change `JWT_SECRET` in `.env` without redeploying | Feed access fails with 401 even with valid proxy token |

### Phase 6: Nevermined Agent Verification

| # | Step | Action | Expected Result |
|---|------|--------|-----------------|
| 6.1 | Check agent logs | In nevermined.app → **Agents** → your Flare FTSO Oracle Feed agent → **Logs** | Logs show successful payment verification and feed access |
| 6.2 | Check credit consumption | In nevermined.app → **Agents** → your agent → **Plans** | Credits are being deducted from the plan |
| 6.3 | Verify proxy URL | In nevermined.app → **Agents** → your agent → **Settings** | Proxy URL is `https://flare-nevermined-oracle.flare-oracle.workers.dev` |

### Quick-Start: Minimal Test Commands

```bash
# 1. Health check
curl https://flare-nevermined-oracle.flare-oracle.workers.dev/health

# 2. Get x402 token
X402_TOKEN=$(NVM_API_KEY="$NVM_API_KEY" NVM_PLAN_ID="$NVM_PLAN_ID" NVM_AGENT_ID="$NVM_AGENT_ID" node get-x402-token.mjs)

# 3. Exchange for JWT
PROXY_TOKEN=$(curl -s -X POST https://flare-nevermined-oracle.flare-oracle.workers.dev/api/v1/x402/exchange \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $X402_TOKEN" | jq -r '.token')

# 4. Query the feed
curl -H "Authorization: Bearer $PROXY_TOKEN" https://flare-nevermined-oracle.flare-oracle.workers.dev/api/v1/feed
```

## Related

- [Architecture](architecture.md) — components and design decisions
- [Deployment](deployment.md) — run and deploy the Worker
- [Launch](launch.md) — production readiness checklist
