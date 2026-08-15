# Launch — flare-nevermined-oracle

End-to-end guide for taking the oracle feed live on Nevermined with the Cloudflare Worker.

## Prerequisites

1. Create a Nevermined account at https://nevermined.io and obtain your sandbox credentials:
   - `NEVERMINED_APP_ID` — your application ID from the Nevermined dashboard
   - `NEVERMINED_APP_SECRET` — your application secret from the Nevermined dashboard
2. Copy `.env.example` to `.env` and fill in all required values (see [Configuration](deployment.md#configuration)).
3. Install dependencies: `npm install`

## Step 1: Test Against Coston2 Testnet

Before deploying, verify the service works against the Coston2 testnet:

```bash
npm test               # unit tests
npm run test:integration
npm run test:e2e
```

## Step 2: Run the Worker Locally

```bash
npm run dev
```

Starts a local `wrangler dev` instance (default port 8787) with hot-reload:

```bash
curl http://localhost:8787/health
# → { "status": "ok", "timestamp": "..." }
```

## Step 3: Publish Asset to Nevermined

Register the oracle feed as a Nevermined asset with payment gating:

```bash
npm run publish-asset
```

This script (`scripts/publishAsset.ts`):
1. Initializes the Nevermined Payments SDK with your sandbox credentials
2. Queries Nevermined contract addresses for the configured payment chain
3. Registers the Flare FTSO Oracle Feed asset with a pay-per-access plan
4. Outputs the agent ID, plan ID, and proxy configuration instructions

**Required env vars for publish:**
- `NVM_API_KEY` — Nevermined API key (different from app ID/secret)
- `NEVERMINED_APP_ID` — from `.env`
- `NEVERMINED_APP_SECRET` — from `.env`

After successful registration, add the published IDs to `.env`:

```env
NVM_AGENT_ID=...
NVM_PLAN_ID=...
```

## Step 4: Deploy and Configure the Nevermined Proxy

1. Deploy the Worker (see [Deployment](deployment.md)):
   ```bash
   npm run deploy
   ```
2. In the [Nevermined App](https://nevermined.app) dashboard → **Agents** → your Flare FTSO Oracle Feed agent → **Settings**, set the **proxy URL** to your Worker URL:
   ```
   https://flare-nevermined-oracle.flare-oracle.workers.dev
   ```
3. Optional — in the same **Settings**, set the **Agent definition** field (a discoverable A2A Agent Card) to:
   ```
   https://flare-nevermined-oracle.flare-oracle.workers.dev/.well-known/agent.json
   ```

The proxy will:
- Verify that the consumer has an active payment plan
- Issue a time-bound JWT after successful payment verification
- Forward validated requests to your Worker at `.../api/v1/feed`

## Step 5: Harden Before Production

The Worker is directly reachable at its `*.workers.dev` URL, so the endpoints must be hardened before going live. The code-level hardening below is already implemented; the remaining items are configuration.

### 5a. x402 token verification + settlement (implemented)

`POST /api/v1/x402/exchange` no longer trusts the decoded x402 claims blindly. It calls the Nevermined backend `/api/v1/x402/verify` endpoint (`src/x402.ts` `verifyX402Token`) and only mints a JWT when the backend confirms `isValid`. On success it then **settles** the credits via `/api/v1/x402/settle` (`settleX402Token`), which burns the subscriber's credits and reports the execution back to the Nevermined dashboard — this is what populates the platform's active consumption/execution metrics. The backend URL is derived from the `NVM_API_KEY` prefix (`sandbox:` → `api.sandbox.nevermined.app`, `live:` → `api.live.nevermined.app`).

- Requires `NVM_API_KEY` to be set on the Worker. If missing, the endpoint returns `500` (`x402 verification unavailable`).
- `paymentRequired` is reconstructed from the token's `planId`, `agentId`, `httpVerb` (`GET`) and resource `/api/v1/feed`, matching the subscriber's payment intent.
- A failed settlement returns `402` (payment required) and no JWT is minted; a failed verification returns `401`.
- The `agentRequestId` from the verify response is forwarded to the settle call for observability tracking.

### 5b. Restrict CORS (implemented)

`src/worker.ts` now applies `cors({ origin: CORS_ORIGIN })` when the `CORS_ORIGIN` binding is set. Set it to your production domain, e.g. in `wrangler.toml`:

```toml
[vars]
CORS_ORIGIN = "https://your-production-domain.com"
```

When `CORS_ORIGIN` is unset the Worker keeps the permissive `cors()` default, so **set it before going live**.

### 5c. Add rate limiting (implemented)

A sliding-window rate limiter keyed by client IP (`cf-connecting-ip`) is wired into `/api/v1/x402/exchange` and `/api/v1/feed` (`src/rateLimiter.ts`). Configure via bindings:

```toml
[vars]
RATE_LIMIT_MAX = "100"
RATE_LIMIT_WINDOW_SECONDS = "60"
```

Defaults: 100 requests / 60 seconds. The in-memory limiter is per-isolate; for strict global limits add a Cloudflare [rate limiting rule](https://developers.cloudflare.com/rate-limiting/) as well.

### 5d. Use live Nevermined credentials

- Switch `NVM_API_KEY` from the `sandbox:` prefix to your **`live:`** production key.
- Re-run `npm run publish-asset` with live credentials — this **creates new `NVM_AGENT_ID`/`NVM_PLAN_ID`**. Replace the sandbox IDs in `.env` and re-point the Nevermined proxy to the same Worker.
- Set `API_ENDPOINT` in `.env` to your production Worker URL (e.g. `https://flare-nevermined-oracle.flare-oracle.workers.dev/api/v1/feed`). `scripts/publishAsset.ts` defaults to the stale `http://localhost:3000/api/v1/feed`, which is wrong for production.

## Step 6: Verify the Payment Flow

Run the E2E script, which exercises the full purchase → x402 token → JWT → feed flow:

```bash
./test-e2e-worker.sh
```

> The purchase leg requires a **subscriber** account with a payment card that subscribes to your agent's plan. A publisher's Stripe account only receives payments. Until a real (or test) subscriber exists, the production wiring is verified but the paid purchase step cannot be exercised end-to-end.

See [Testing](testing.md) for the detailed manual flow (crypto and fiat payment paths).

## Production Checklist

- [x] `FLARE_RPC_URL` points to mainnet Flare RPC (not Coston2)
- [x] `FTSO_FEED_IDS` uses mainnet feed IDs
- [x] `NEVERMINED_PAYMENT_CHAIN` is set to the production chain (e.g., `base`)
- [x] `JWT_SECRET` is a strong, unique secret (not `test-jwt-secret`)
- [x] `NODE_ENV=production` is set
- [x] Secrets are set via `wrangler secret put` (`JWT_SECRET`, `NVM_API_KEY`, `RECEIVER_ADDRESS`)
- [x] Worker is deployed with `npm run deploy` and reachable at its `*.workers.dev` URL
- [x] `NVM_API_KEY` secret is set on the Worker and uses the `live:` prefix (verifies against `api.live.nevermined.app`)
- [x] `.env` has the production `NVM_AGENT_ID`/`NVM_PLAN_ID`
- [x] `API_ENDPOINT` in `.env` points to your production Worker URL
- [ ] `RECEIVER_ADDRESS` confirmed as your production wallet
- [ ] `CORS_ORIGIN` is set to your production domain (Step 5b)
- [ ] `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW_SECONDS` are set (Step 5c)
- [ ] `NEVERMINED_APP_ID`/`NEVERMINED_APP_SECRET` set as Worker secrets (only needed for `publish-asset`)
- [ ] Paid purchase flow verified with a real or test subscriber (Step 6)
- [ ] Active metrics confirmed in the Nevermined App dashboard (exchange settles credits per request, Step 5a)
- [ ] Monitoring and alerting are set up for `/health`

## Monitor and Maintain

- Monitor usage and revenue in the [Nevermined App](https://nevermined.app) dashboard
- Set up alerting on the `/health` endpoint
- Rotate API keys and JWT secrets periodically
- Review payment settlement records for auditability

## Rollback

If the deployed service has issues:

1. Review worker logs: `npx wrangler tail`
2. List deployments: `npx wrangler deployments list`
3. Roll back to a previous stable deployment: `npx wrangler rollback`
4. Re-publish the asset with the previous configuration if needed

## Related

- [Deployment](deployment.md) — deploy steps, configuration, troubleshooting
- [Testing](testing.md) — test layers and the E2E payment flow
