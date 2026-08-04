# Deploy to SnapDeploy

This guide covers deploying the flare-nevermined-oracle Docker container to [SnapDeploy](https://snapdeploy.dev).

## Prerequisites

- A SnapDeploy account (sign up at [snapdeploy.dev](https://snapdeploy.dev))
- Git repository with the project code
- Nevermined sandbox credentials (see `.env` file)

## Step 1: Prepare Your Repository

Ensure all deployment files are committed to your Git repository:

```bash
git add Dockerfile .dockerignore snapdeploy.toml docker-compose.yml
git commit -m "Add Docker deployment files"
git push
```

## Step 2: Connect SnapDeploy to Your Repository

1. Sign in to [SnapDeploy](https://snapdeploy.dev)
2. Click **New Project** or **Add Service**
3. Connect your Git provider (GitHub, GitLab, or Bitbucket)
4. Select the `flare-nevermined-oracle` repository
5. SnapDeploy will auto-detect the `Dockerfile` and configure the build

## Step 3: Configure Environment Variables

In the SnapDeploy dashboard, go to your project's **Environment Variables** section and add the following:

### Required Variables

| Variable                   | Value                                                                           | Description                                                               |
| -------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `NVM_API_KEY`              | `sandbox:your-api-key`                                                          | Nevermined API key from [nevermined.app](https://nevermined.app) Settings |
| `NVM_ENVIRONMENT`          | `sandbox`                                                                       | Nevermined environment (sandbox or live)                                |
| `NVM_PLAN_ID`             | `your-plan-id`                                                                  | From the Nevermined App dashboard                                         |
| `NVM_AGENT_ID`            | `your-agent-id`                                                                 | From the Nevermined App dashboard                                         |
| `JWT_SECRET`               | `your-strong-secret`                                                            | Secret for signing/verifying JWTs                                         |
| `RECEIVER_ADDRESS`         | `0xYourWalletAddress`                                                           | Wallet address to receive payments                                        |
| `FLARE_RPC_URL`            | `https://coston2-api.flare.network/ext/C/rpc`                                   | Coston2 testnet RPC (sandbox)                                             |
| `FTSO_FEED_IDS`            | `0x01464c522f5553440000000000000000000000,0x014254432f5553440000000000000000000000` | FTSO feed IDs                                                             |
| `NEVERMINED_PAYMENT_CHAIN` | `base`                                                                          | Payment blockchain                                                        |
| `PORT`                     | `3000`                                                                          | Server port                                                               |
| `NODE_ENV`                 | `production`                                                                    | Node environment                                                          |

### Optional Variables

| Variable                   | Value                                         | Description                 |
| -------------------------- | --------------------------------------------- | --------------------------- |
| `NEVERMINED_APP_ID`        | `your-app-id`                                 | From the Nevermined App dashboard (used for asset publishing) |
| `NEVERMINED_APP_SECRET`    | `your-app-secret`                             | From the Nevermined App dashboard (used for asset publishing) |
| `TEST_RPC_URL`             | `https://coston2-api.flare.network/ext/C/rpc` | Override RPC for tests      |
| `TEST_CHAIN_ID`            | `114`                                         | Override chain ID for tests |

## Step 4: Configure the Build

SnapDeploy auto-detects the `Dockerfile`. Verify the following settings in the dashboard:

- **Build Command**: `docker build -t flare-nevermined-oracle .` (auto-detected)
- **Start Command**: `node dist/src/server.js` (auto-detected from Dockerfile CMD)
- **Port**: `3000`

## Step 5: Deploy

1. Click **Deploy** in the SnapDeploy dashboard
2. SnapDeploy will:
   - Pull your repository
   - Build the Docker image using the `Dockerfile`
   - Push the image to its registry
   - Start the container
3. Wait for the deployment to complete (usually 1-2 minutes)

## Step 6: Verify the Deployment

Once deployed, SnapDeploy provides a public URL (e.g., `https://nevermined-oracle-7c351.containers.snapdeploy.app`).

### Test the Health Endpoint

```bash
curl https://nevermined-oracle-7c351.containers.snapdeploy.app/health
```

Expected response:

```json
{ "status": "ok", "timestamp": "2026-08-02T00:00:00.000Z" }
```

### Test the Feed Endpoint (Requires JWT)

```bash
# Generate a JWT token
TOKEN=$(node generate-token.mjs)

# Query the feed
curl -H "Authorization: Bearer $TOKEN" https://nevermined-oracle-7c351.containers.snapdeploy.app/api/v1/feed
```

## Step 7: Configure Nevermined Proxy

1. Go to the [Nevermined App](https://nevermined.app) dashboard
2. Navigate to **Agents** → find your Flare FTSO Oracle Feed agent
3. In the agent settings, set the **proxy URL** to your SnapDeploy URL:
   ```
   https://nevermined-oracle-7c351.containers.snapdeploy.app
   ```
4. Save the configuration

## Step 8: Test the Full Payment Flow

This step verifies that the entire payment pipeline works end-to-end: purchase → x402 token → JWT → feed access.

### 8.1 Purchase a Plan via Nevermined Checkout

Open the Nevermined checkout URL in your browser to purchase a data access plan:

```
https://nevermined.app/checkout/36075941597155882654843026786416689681953831667949314988177565256484600000081
```

This plan is tied to your Nevermined agent and grants credits for accessing the Flare FTSO oracle feed. After completing the purchase, note the **Plan ID** and **Agent ID** from the Nevermined dashboard (**Agents** → your Flare FTSO Oracle Feed agent).

### 8.2 Obtain an x402 Access Token

After payment, use the Nevermined Payments SDK to obtain an x402 access token. Create a script `get-x402-token.mjs`:

```javascript
import { Payments } from "@nevermined-io/payments";
import * as dotenv from "dotenv";

dotenv.config();

const nvm = await Payments.getInstance({
  nvmApiKey: process.env.NVM_API_KEY,
});

const { delegationId } = await nvm.delegation.createDelegation({
  provider: "erc4337",
  spendingLimitCents: 10000,
  durationSecs: 604800,
  currency: "usdc",
  planId: process.env.NVM_PLAN_ID,
});

const { accessToken } = await nvm.x402.getX402AccessToken(
  process.env.NVM_PLAN_ID,
  process.env.NVM_AGENT_ID,
  {
    delegationConfig: { delegationId },
  },
);

console.log(accessToken);
```

Run it:

```bash
NVM_API_KEY=sandbox:your-api-key NVM_PLAN_ID=your-plan-id NVM_AGENT_ID=your-agent-id node get-x402-token.mjs
```

Save the output as your x402 token:

```bash
X402_TOKEN=$(node get-x402-token.mjs)
```

### 8.3 Exchange the x402 Token for a JWT via the Nevermined Proxy

Send the x402 token to the Nevermined proxy, which verifies the payment and issues a time-bound JWT:

```bash
PROXY_TOKEN=$(curl -s -X POST https://nevermined-oracle-7c351.containers.snapdeploy.app/api/v1/x402/exchange \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $X402_TOKEN" \
  | jq -r '.token')
```

Expected response:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### 8.4 Query the Feed Through the Proxy

Use the JWT to access the oracle feed:

```bash
curl -H "Authorization: Bearer $PROXY_TOKEN" \
  https://nevermined-oracle-7c351.containers.snapdeploy.app/api/v1/feed
```

Expected response:

```json
{
  "success": true,
  "data": {
    "feeds": [
      {
        "feedId": "0x01464c522f55534400000000000000000000000000",
        "value": "1.2345",
        "decimals": 18,
        "timestamp": 1234567890,
        "valueInWei": "1234500000000000000000"
      },
      {
        "feedId": "0x014254432f55534400000000000000000000000000",
        "value": "67890.12",
        "decimals": 2,
        "timestamp": 1234567890,
        "valueInWei": "6789012000000000000"
      }
    ],
    "blockHeight": 12345678,
    "networkTimestamp": 1234567890,
    "requestId": "0x..."
  }
}
```

### 8.5 Verify the Full Flow Locally (Optional)

Before testing on SnapDeploy, you can verify the flow locally:

```bash
# Start the server locally
npm run dev

# In a separate terminal, get the x402 token
X402_TOKEN=$(node get-x402-token.mjs)

# Exchange for a JWT via the local proxy (if configured)
PROXY_TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/x402/exchange \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $X402_TOKEN" \
  | jq -r '.token')

# Query the feed
curl -H "Authorization: Bearer $PROXY_TOKEN" \
  http://localhost:3000/api/v1/feed
```

### 8.6 Troubleshooting the Payment Flow

| Issue | Solution |
|-------|----------|
| Checkout page returns 404 | Verify the plan ID is correct and the agent is active in the Nevermined dashboard |
| `getX402AccessToken` fails with 401 | Ensure `NVM_API_KEY` is set correctly and has the right permissions |
| x402 exchange returns 403 | Confirm the x402 token is not expired and the plan has available credits |
| JWT exchange returns 401 | Verify the Nevermined proxy URL is configured and the agent has the correct permissions |
| Feed returns 401 after JWT exchange | Ensure the JWT is passed as `Authorization: Bearer <token>` and `JWT_SECRET` matches between the proxy and the API |
| `Unsupported chain ID` | Verify `NEVERMINED_PAYMENT_CHAIN` matches the chain where the payment was made |
| Cold start delay on first payment | SnapDeploy containers auto-sleep; the first request after inactivity may take 10-30s |

## Step 9: Set Up Auto-Deploy

SnapDeploy supports automatic deployments on git push:

1. In the SnapDeploy dashboard, go to **Settings** → **Auto-Deploy**
2. Enable auto-deploy for the `main` branch
3. Every `git push` to `main` will trigger a new build and deployment

## Managing Deployments

### View Logs

In the SnapDeploy dashboard, go to your project and click **Logs** to view container output.

### Restart

Click **Restart** in the dashboard to restart the container.

### Rollback

SnapDeploy keeps a history of deployments. Click **Deployments** and select a previous deployment to roll back.

### Update Environment Variables

1. Go to **Settings** → **Environment Variables**
2. Update any variable
3. Click **Redeploy** to apply changes

## Troubleshooting

| Issue                       | Solution                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| Container crashes on start  | Check logs for missing env vars; ensure `NVM_API_KEY` and `JWT_SECRET` are set                |
| WAIT_FOR_HEALTHY failing    | Verify all required env vars are set; switch base image from `node:20-alpine` to `node:20-slim` if native deps fail |
| Health endpoint returns 500 | Verify `FLARE_RPC_URL` is accessible from the SnapDeploy network                              |
| Feed endpoint returns 401   | Ensure JWT is valid and not expired; check `JWT_SECRET` matches                               |
| Payment flow fails          | Verify `NVM_API_KEY`, `NVM_PLAN_ID`, and `NVM_AGENT_ID` are set correctly |
| Build fails                 | Check `Dockerfile` syntax; ensure `package.json` and `package-lock.json` are in the repo root |
| Cold start delay            | SnapDeploy containers auto-sleep after inactivity; first request may take 10-30s              |

## Production Deployment

For production, repeat the same steps but with these changes:

1. Use `live` credentials (API key with `live:` prefix) instead of `sandbox`
2. Use mainnet Flare RPC URL
3. Use mainnet FTSO feed IDs
4. Use your production wallet address for `RECEIVER_ADDRESS`
5. Set `NODE_ENV=production`
6. Configure a custom domain in SnapDeploy settings
7. Enable HTTPS (SnapDeploy provides this automatically)
