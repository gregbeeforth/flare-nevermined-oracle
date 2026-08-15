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

The proxy will:
- Verify that the consumer has an active payment plan
- Issue a time-bound JWT after successful payment verification
- Forward validated requests to your Worker at `.../api/v1/feed`

## Step 5: Verify the Payment Flow

Run the E2E script, which exercises the full purchase → x402 token → JWT → feed flow:

```bash
./test-e2e-worker.sh
```

See [Testing](testing.md) for the detailed manual flow (crypto and fiat payment paths).

## Production Checklist

- [ ] `FLARE_RPC_URL` points to mainnet Flare RPC (not Coston2)
- [ ] `FTSO_FEED_IDS` uses mainnet feed IDs
- [ ] `NEVERMINED_APP_ID` and `NEVERMINED_APP_SECRET` are production credentials
- [ ] `NEVERMINED_PAYMENT_CHAIN` is set to the production chain (e.g., `base`)
- [ ] `RECEIVER_ADDRESS` is your production wallet address
- [ ] `JWT_SECRET` is a strong, unique secret (not `test-jwt-secret`)
- [ ] `NODE_ENV=production` is set
- [ ] Secrets are set via `wrangler secret put` (`JWT_SECRET`, `NVM_API_KEY`, `NEVERMINED_APP_ID`, `NEVERMINED_APP_SECRET`, `RECEIVER_ADDRESS`)
- [ ] Worker is deployed with `npm run deploy` and reachable at its `*.workers.dev` URL
- [ ] CORS is configured for your production domain
- [ ] Monitoring and alerting are set up for `/health`
- [ ] Rate limiting is configured on the Worker
- [ ] `npm run publish-asset` has been run with production credentials

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
