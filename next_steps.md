# Next Steps — flare-nevermined-oracle

## Pre-Launch Testing (Before Nevermined Deployment)

Before launching on Nevermined, the service should be validated through several testing layers:

### 1. Unit Tests (Already in Place)
```bash
npm test
```
Mocked, fast tests that verify env var parsing and JWT middleware logic without any network calls.

### 2. Integration Tests Against Coston2 Testnet (Already in Place)
```bash
npm run test:integration
```
Connects to the real Coston2 testnet to verify `FlareConsumer` can resolve contract addresses and read live FTSO feeds. Free, no real funds at risk.

### 3. E2E Tests Against Live Server (Already in Place)
```bash
npm run test:e2e
```
Starts the Express server and tests the full HTTP request/response cycle with `supertest`, including JWT auth and real Flare data.

### 4. Manual Curl Testing
Generate a test JWT and manually test the endpoints:
```bash
# Generate a JWT
TOKEN=$(node -e "const { SignJWT } = require('jose'); const s = new TextEncoder().encode(process.env.JWT_SECRET); SignJWT({sub:'test'}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(s).then(t => console.log(t))")

# Test health endpoint (no auth needed)
curl http://localhost:3000/health

# Test feed endpoint (requires JWT)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/feed
```

### 5. Docker-Based Local Flare Node (Optional)
Run a local Flare Coston2 node using Docker to test against a fully controlled environment:
```bash
# Example: run a local Flare node with Coston2 config
docker run -p 9650:9650 flareproject/flare:latest --coston2
```
This allows testing with `TEST_RPC_URL=http://localhost:9650/ext/C/rpc` and `TEST_CHAIN_ID=114`. Useful for CI environments or when the public Coston2 RPC is rate-limited.

### 6. Nevermined Sandbox/Test Environment
Nevermined provides a sandbox environment for testing the payment gating flow without real transactions:
- Set `NEVERMINED_APP_ID` and `NEVERMINED_APP_SECRET` to sandbox credentials
- Use the sandbox Nevermined proxy URL instead of production
- Test the full payment → JWT → feed access flow end-to-end

### 7. Load Testing (Optional)
Before launch, verify the service can handle expected traffic:
```bash
# Install a load testing tool (e.g., autocannon)
npx autocannon -c 10 -d 30 -p 5 http://localhost:3000/api/v1/feed
```
This sends 10 concurrent connections for 30 seconds with 5 pipelined requests, testing throughput and latency under load.

### 8. Postman/Insomnia API Collection (Optional)
Create a Postman or Insomnia collection with pre-configured requests for all endpoints, including JWT generation, to make manual testing repeatable and shareable with team members.

## Running Tests

### Prerequisites
```bash
cd flare-nevermined-oracle
cp .env.example .env
# Edit .env:
#   - Set FLARE_RPC_URL to Coston2 (needed for integration/E2E tests)
#   - Set JWT_SECRET (needed for E2E JWT generation and auth middleware)
#   - Set TEST_RPC_URL if you want tests to use a different RPC (e.g., a local node)
#   - Set TEST_CHAIN_ID to match your RPC (114 for Coston2, 14 for Flare mainnet)
npm install
npm run build   # compile TypeScript to dist/ before running the server
```

### Why these env vars matter
- `.env` is gitignored — it keeps secrets and network-specific config out of the repo
- `FLARE_RPC_URL` points to Coston2 testnet so integration/E2E tests connect to a real Flare network without risking real funds
- `JWT_SECRET` is used by the auth middleware (`jwtAuth.ts`) to sign/verify tokens, and by E2E tests to generate valid JWTs for the `/api/v1/feed` endpoint
- `TEST_RPC_URL` / `TEST_CHAIN_ID` let tests override the default RPC without polluting `.env` — useful for CI or local development with a custom node

### Test Commands
```bash
npm test              # All tests (unit + integration, requires network access to Coston2)
npm run test:integration  # Integration tests only (FlareConsumer + server, real Coston2 RPC)
npm run test:e2e        # E2E tests only (live server + real Flare data via supertest)
```

Note: `npm test` runs all test files matching `**/*.test.ts`, which includes both unit and integration tests. For fast feedback during development, use `npm run test:integration` to run only integration tests, or run unit tests directly with `npx jest --testPathPattern=flareConsumer.test` and `npx jest --testPathPattern=jwtAuth.test`.

### Prerequisites for Integration/E2E Tests
- A working internet connection to reach `coston2-api.flare.network`
- `.env` must exist with `FLARE_RPC_URL=https://coston2-api.flare.network/ext/C/rpc`
- `JWT_SECRET` must be set (used for E2E JWT generation)

## Possible Next Steps

1. **Add retry logic** to `FlareConsumer` for rate-limited Coston2 RPC calls — Public Coston2 RPC endpoints can rate-limit or temporarily go down. Retry logic with exponential backoff prevents transient failures from breaking tests and improves reliability in production.

2. **Add `@integration` test tags** to isolate integration/E2E tests from unit tests in CI — Without tags, CI runs all tests including slow integration ones on every commit. Tagging lets CI run fast unit tests on every push and integration/E2E tests only on PRs or nightly builds.

3. **Add Coston2-specific feed IDs** to `.env` if different from mainnet feeds — The current feed IDs (`FLR/USD`, `BTC/USD`) may differ between mainnet and Coston2. Using Coston2-specific feed IDs ensures integration tests validate against the correct data source.

4. **Add `TestFtsoV2` support** in `flareConsumer.ts` — Coston2 has a `TestFtsoV2` contract with all `view` methods and no fees, unlike mainnet `FtsoV2` which has gas costs. Using `TestFtsoV2` in tests is cheaper, faster, and avoids consuming gas on the testnet.

5. **CI pipeline** — add `npm run test:integration` and `npm run test:e2e` to GitHub Actions with Coston2 RPC URL as a secret — This ensures integration and E2E tests run automatically on every PR, catching regressions before they reach production. The Coston2 RPC URL should be stored as a GitHub secret to avoid exposing it in the repo.

6. **Nevermined `publish-asset` integration test** — mock or skip if `NVM_API_KEY` is missing — The `publish-asset` script requires real Nevermined API keys. Integration tests should mock the Nevermined SDK or skip entirely when `NVM_API_KEY` is not set, so they don't fail in CI environments without real credentials.

## After Publishing the Asset to Nevermined Sandbox

Once `npm run publish-asset` succeeds, the asset is registered with Nevermined and you receive an `agentId` and `planId`. The next steps are to configure the Nevermined proxy, test the payment flow, and eventually go live.

### Step 1: Configure the Nevermined Proxy

The Nevermined proxy sits between consumers and your Express API. It handles payment verification, JWT issuance, and request forwarding.

1. **Expose your local server with a public tunnel** — the proxy needs a reachable URL:
   ```bash
   ngrok http 3000
   ```
   This gives you a public URL like `https://abc123.ngrok-free.app`

2. Go to the [Nevermined App](https://nevermined.app) dashboard
3. Navigate to **Agents** and find your registered Flare FTSO Oracle Feed agent
4. In the agent settings, set the **proxy URL** to your tunnel URL (e.g., `https://abc123.ngrok-free.app`)

The proxy will:
- Verify that the consumer has an active payment plan
- Issue a time-bound JWT after successful payment verification
- Forward validated requests to your Express API at `http://localhost:3000/api/v1/feed`

### Step 2: Test the Full Payment Flow Through the Proxy

After the proxy is configured, test the complete flow:

```bash
# 1. Start the Express server
npm run dev

# 2. Test the health endpoint (no auth needed, works without proxy)
curl http://localhost:3000/health

# 3. Test the feed endpoint directly (requires JWT)
TOKEN=$(node --input-type=module -e "
const { SignJWT } = await import('jose');
const s = new TextEncoder().encode(process.env.JWT_SECRET);
const t = await new SignJWT({ sub: 'test-user' })
  .setProtectedHeader({ alg: 'HS256' })
  .setExpirationTime('1h')
  .sign(s);
console.log(t);
")
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/feed

# 4. Test through the Nevermined proxy (requires payment)
# Replace with your actual proxy URL from Step 1
curl https://your-nevermined-proxy-url/api/v1/feed
# Should return 401 (no JWT provided)

# 5. Purchase a plan and obtain an x402 access token
# Use the Nevermined SDK as a subscriber to buy the plan and get a token
```

### Step 3: Verify Sandbox Payment Flow End-to-End

The sandbox environment uses test USDC on Base Sepolia testnet and Stripe test cards — no real money is charged.

1. **Crypto payment path**: Fund your sandbox wallet with test USDC from the [Circle USDC Faucet](https://faucet.circle.com/), then purchase the plan and get an x402 access token
2. **Fiat payment path**: Use Stripe test cards (e.g., `4242 4242 4242 4242`) to purchase a plan and get an x402 access token
3. **Exchange the token** for a JWT via the Nevermined proxy
4. **Access the feed** with the JWT

Expected successful response from the proxy:
```json
{
  "success": true,
  "data": {
    "feeds": [...],
    "blockHeight": 12345678,
    "networkTimestamp": 1234567890,
    "requestId": "0x..."
  }
}
```

### Step 4: Update `.env` with Published IDs

After successful registration, add the agent and plan IDs to your `.env`:

```env
NVM_AGENT_ID=36075941597155882654843026786416689681953831667949314988177565256484600000081
NVM_PLAN_ID=40743688611427105982248667827622520342780227742182160007037770161859192304254
```

These IDs are used by the server and tests to reference the published asset.

### Step 5: Switch to Live Environment for Production

When ready to go live:

1. **Get live credentials**: Create a new API key at [nevermined.app](https://nevermined.app) with the `live:` prefix
2. **Update `.env`**:
   ```env
   NVM_API_KEY=live:your-live-api-key
   NVM_ENVIRONMENT=live
   NEVERMINED_APP_ID=your-live-app-id
   NEVERMINED_APP_SECRET=your-live-app-secret
   RECEIVER_ADDRESS=0xYourProductionWalletAddress
   ```
3. **Update `FLARE_RPC_URL`** to point to mainnet Flare RPC
4. **Update `FTSO_FEED_IDS`** to use mainnet feed IDs
5. **Re-publish the asset**: Run `npm run publish-asset` with live credentials
6. **Deploy the server** behind a reverse proxy (nginx/Caddy) with HTTPS
7. **Test the live flow** end-to-end with real payments

### Step 6: Monitor and Maintain

- Monitor usage and revenue in the [Nevermined App](https://nevermined.app) dashboard
- Set up alerting on the `/health` endpoint
- Rotate API keys and JWT secrets periodically
- Review payment settlement records for auditability

## Docker Deployment

### Build the Image

```bash
docker build -t flare-nevermined-oracle .
```

### Run Locally with Docker

```bash
docker run -d --name flare-oracle -p 3000:3000 --env-file .env flare-nevermined-oracle

# Verify
curl http://localhost:3000/health

# Stop
docker stop flare-oracle && docker rm flare-oracle
```

### Run with Docker Compose

```bash
docker-compose up -d

# Verify
curl http://localhost:3000/health

# Stop
docker-compose down
```

### Deploy to SnapDeploy

1. Sign up at [snapdeploy.dev](https://snapdeploy.dev)
2. Connect your Git repository (GitHub)
3. SnapDeploy auto-detects the `Dockerfile` and builds the image
4. Set environment variables in the SnapDeploy dashboard:
   - `NVM_API_KEY` — your sandbox or live Nevermined API key
   - `NVM_ENVIRONMENT` — `sandbox` or `live`
   - `NEVERMINED_APP_ID` — from the Nevermined dashboard
   - `NEVERMINED_APP_SECRET` — from the Nevermined dashboard
   - `JWT_SECRET` — a strong random secret
   - `RECEIVER_ADDRESS` — your wallet address
   - `FLARE_RPC_URL` — `https://coston2-api.flare.network/ext/C/rpc` (sandbox) or mainnet RPC
   - `FTSO_FEED_IDS` — your FTSO feed IDs
   - `NEVERMINED_PAYMENT_CHAIN` — `base`
5. Deploy — SnapDeploy builds and deploys automatically on git push
6. Get your public URL (e.g., `https://your-app.snapdeploy.app`)
7. Configure the Nevermined proxy URL in the [Nevermined App](https://nevermined.app) dashboard with your SnapDeploy URL

### Deploy to Render (Free Tier)

1. Push your code to GitHub
2. Go to [render.com](https://render.com) and create a new Web Service
3. Connect your repository
4. Configure:
   - **Build Command**: `npm run build`
   - **Start Command**: `node dist/src/server.js`
   - **Instance Type**: Free tier (0.1 vCPU, 512 MB RAM)
5. Set environment variables in the Render dashboard (same as SnapDeploy)
6. Deploy — Render provides a public URL
7. Configure the Nevermined proxy URL with your Render URL

### Deploy to Google Cloud Run (Generous Free Tier)

1. Authenticate with GCP: `gcloud auth login`
2. Build and push the image:
   ```bash
   gcloud builds submit --tag gcr.io/PROJECT_ID/flare-oracle
   ```
3. Deploy:
   ```bash
   gcloud run deploy flare-oracle \
     --image gcr.io/PROJECT_ID/flare-oracle \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --set-env-vars NVM_API_KEY=sandbox:your-key,NVM_ENVIRONMENT=sandbox
   ```
4. Note the service URL output by `gcloud run`
5. Configure the Nevermined proxy URL with the Cloud Run URL

### SnapDeploy vs Render vs Cloud Run Comparison

| Feature | SnapDeploy | Render | Cloud Run |
|---|---|---|---|
| Free tier | 10 deploys/day, auto-sleep | 750 hrs/month, cold starts | 180K vCPU-sec/month |
| Credit card | Not required | Not required | Required |
| Docker native | Yes | Yes | Yes |
| Auto-deploy from Git | Yes | Yes | Yes |
| Custom domain | Yes | Yes | Yes |
| HTTPS | Yes | Yes | Yes |
| Cold starts | 10-30s | 30-50s | Yes (scale-to-zero) |
| Setup complexity | Low | Low | Medium |