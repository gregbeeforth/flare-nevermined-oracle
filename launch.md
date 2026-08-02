# Launch Guide — flare-nevermined-oracle

## Prerequisites

### 1. Nevermined Account & Sandbox Setup

1. Create a Nevermined account at https://nevermined.io
2. Obtain your sandbox credentials:
   - `NEVERMINED_APP_ID` — your application ID from the Nevermined dashboard
   - `NEVERMINED_APP_SECRET` — your application secret from the Nevermined dashboard
3. Verify your sandbox environment is accessible by running a test publish

### 2. Environment Configuration

Copy `.env.example` to `.env` and fill in all required values:

```bash
cp .env.example .env
```

Edit `.env` with the following values:

```env
# Flare network — use Coston2 testnet for sandbox testing
FLARE_RPC_URL=https://coston2-api.flare.network/ext/C/rpc

# FTSO feed IDs — Coston2-specific (21-byte bytes21 format)
FTSO_FEED_IDS=0x01464c522f5553440000000000000000000000,0x014254432f5553440000000000000000000000

# JWT secret — used for auth middleware and E2E tests
JWT_SECRET=your-secure-random-secret-here

# Nevermined sandbox credentials
NEVERMINED_APP_ID=your-sandbox-app-id
NEVERMINED_APP_SECRET=your-sandbox-app-secret

# Nevermined payment chain (sandbox typically uses base or goerli)
NEVERMINED_PAYMENT_CHAIN=base

# Receiver address — where payments are sent
RECEIVER_ADDRESS=0x00000000000000000000000000000000000000

# Server configuration
PORT=3000
NODE_ENV=development

# Test overrides (optional)
TEST_RPC_URL=https://coston2-api.flare.network/ext/C/rpc
TEST_CHAIN_ID=114
```

### 3. Install Dependencies & Build

```bash
cd flare-nevermined-oracle
npm install
npm run build
```

## Deployment Steps

### Step 1: Test Against Coston2 Testnet

Before deploying to Nevermined, verify the service works against the Coston2 testnet:

```bash
# Run unit tests
npm test

# Run integration tests (real Coston2 RPC)
npm run test:integration

# Run E2E tests (live server + real Flare data)
npm run test:e2e
```

### Step 2: Start the Server Locally

```bash
npm run dev
```

The server starts on port 3000 with hot-reload. Verify the health endpoint:

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2026-08-01T00:00:00.000Z"
}
```

### Step 3: Generate a Test JWT

Generate a JWT for manual testing of the `/api/v1/feed` endpoint:

```bash
TOKEN=$(node -e "const { SignJWT } = require('jose'); const s = new TextEncoder().encode(process.env.JWT_SECRET); SignJWT({sub:'test'}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(s).then(t => console.log(t))")
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/feed
```

Expected response:
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

### Step 4: Publish Asset to Nevermined Sandbox

Register the oracle feed as a Nevermined asset with payment gating:

```bash
npm run publish-asset
```

This script (`scripts/publishAsset.ts`) will:
1. Initialize the Nevermined Payments SDK with your sandbox credentials
2. Query Nevermined contract addresses for the configured payment chain
3. Register the Flare FTSO Oracle Feed asset with a pay-per-access plan
4. Output the agent ID, plan ID, and proxy configuration instructions

**Required env vars for publish:**
- `NVM_API_KEY` — Nevermined API key (different from app ID/secret)
- `NEVERMINED_APP_ID` — from `.env`
- `NEVERMINED_APP_SECRET` — from `.env`

### Step 5: Configure Nevermined Proxy

After publishing, configure the Nevermined proxy to gate the `/api/v1/feed` endpoint:

1. Use the proxy URL output by `publish-asset`
2. Plug the proxy URL into your Nevermined dashboard configuration
3. The proxy will:
   - Verify payment before forwarding requests
   - Issue time-bound JWTs to paying consumers
   - Forward validated requests to your Express API

### Step 6: Verify Sandbox Deployment

1. Start the Express server (if not already running):
   ```bash
   npm run dev
   ```

2. Test the Nevermined proxy endpoint (use the proxy URL from Step 4):
   ```bash
   curl https://your-nevermined-proxy-url/api/v1/feed
   ```
   This should return 401 (no JWT provided).

3. Obtain a JWT from the Nevermined proxy (after payment verification):
   ```bash
   # The proxy issues a JWT after successful payment
   PROXY_TOKEN=$(curl -X POST https://your-nevermined-proxy-url/auth \
     -H "Content-Type: application/json" \
     -d '{"consumerId":"test-consumer"}' | jq -r '.token')
   ```

4. Access the feed through the proxy:
   ```bash
   curl -H "Authorization: Bearer $PROXY_TOKEN" \
     https://your-nevermined-proxy-url/api/v1/feed
   ```

## Production Deployment Checklist

- [ ] `FLARE_RPC_URL` points to mainnet Flare RPC (not Coston2)
- [ ] `FTSO_FEED_IDS` uses mainnet feed IDs
- [ ] `NEVERMINED_APP_ID` and `NEVERMINED_APP_SECRET` are production credentials
- [ ] `NEVERMINED_PAYMENT_CHAIN` is set to the production chain (e.g., `base`)
- [ ] `RECEIVER_ADDRESS` is your production wallet address
- [ ] `JWT_SECRET` is a strong, unique secret (not `test-jwt-secret`)
- [ ] `NODE_ENV=production` is set
- [ ] Server is behind a reverse proxy (nginx/Caddy) with HTTPS
- [ ] CORS is configured for your production domain
- [ ] Monitoring and alerting are set up for `/health` endpoint
- [ ] Rate limiting is configured on the Express server
- [ ] `nevermined publish-asset` has been run with production credentials

## Rollback

If the deployed service has issues:

1. Stop the server: `Ctrl+C` or `kill <pid>`
2. Revert `.env` to the previous working configuration
3. Rebuild: `npm run build`
4. Restart: `npm start`
5. Re-publish the asset with the previous configuration if needed

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `ECONNREFUSED` on Coston2 RPC | Check `FLARE_RPC_URL` in `.env`; verify internet connectivity |
| `JWT_SECRET is not set` | Add `JWT_SECRET` to `.env` |
| Feed returns zeroed values | Verify `FTSO_FEED_IDS` are correct Coston2 feed IDs |
| `publish-asset` fails with 401 | Verify `NVM_API_KEY`, `NEVERMINED_APP_ID`, and `NEVERMINED_APP_SECRET` |
| `Unsupported chain ID` | Check that `FLARE_RPC_URL` matches a supported chain (14, 114, 19, 16) |
| CORS errors in browser | Configure CORS origins in `server.ts` |