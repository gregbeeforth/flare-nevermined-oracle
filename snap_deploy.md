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

| Variable | Value | Description |
|---|---|---|
| `NVM_API_KEY` | `sandbox:your-api-key` | Nevermined API key from [nevermined.app](https://nevermined.app) Settings |
| `NVM_ENVIRONMENT` | `sandbox` | Use `sandbox` for testing, `live` for production |
| `NEVERMINED_APP_ID` | `your-app-id` | From the Nevermined App dashboard |
| `NEVERMINED_APP_SECRET` | `your-app-secret` | From the Nevermined App dashboard |
| `JWT_SECRET` | `your-strong-secret` | Secret for signing/verifying JWTs |
| `RECEIVER_ADDRESS` | `0xYourWalletAddress` | Wallet address to receive payments |
| `FLARE_RPC_URL` | `https://coston2-api.flare.network/ext/C/rpc` | Coston2 testnet RPC (sandbox) |
| `FTSO_FEED_IDS` | `0x01464c522f55534400000000000000000000,0x014254432f55534400000000000000000000` | FTSO feed IDs |
| `NEVERMINED_PAYMENT_CHAIN` | `base` | Payment blockchain |
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `production` | Node environment |

### Optional Variables

| Variable | Value | Description |
|---|---|---|
| `TEST_RPC_URL` | `https://coston2-api.flare.network/ext/C/rpc` | Override RPC for tests |
| `TEST_CHAIN_ID` | `114` | Override chain ID for tests |

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

Once deployed, SnapDeploy provides a public URL (e.g., `https://your-app.snapdeploy.app`).

### Test the Health Endpoint

```bash
curl https://your-app.snapdeploy.app/health
```

Expected response:
```json
{"status":"ok","timestamp":"2026-08-02T00:00:00.000Z"}
```

### Test the Feed Endpoint (Requires JWT)

```bash
# Generate a JWT token
TOKEN=$(node generate-token.mjs)

# Query the feed
curl -H "Authorization: Bearer $TOKEN" https://your-app.snapdeploy.app/api/v1/feed
```

## Step 7: Configure Nevermined Proxy

1. Go to the [Nevermined App](https://nevermined.app) dashboard
2. Navigate to **Agents** → find your Flare FTSO Oracle Feed agent
3. In the agent settings, set the **proxy URL** to your SnapDeploy URL:
   ```
   https://your-app.snapdeploy.app
   ```
4. Save the configuration

## Step 8: Test the Full Payment Flow

1. Purchase a plan via the Nevermined checkout:
   ```
   https://nevermined.app/checkout/36075941597155882654843026786416689681953831667949314988177565256484600000081
   ```
2. Obtain an x402 access token after payment
3. Exchange the token for a JWT via the Nevermined proxy
4. Query the feed through the proxy:
   ```bash
   curl -H "Authorization: Bearer $PROXY_TOKEN" https://your-app.snapdeploy.app/api/v1/feed
   ```

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

| Issue | Solution |
|---|---|
| Container crashes on start | Check logs for missing env vars; ensure `NVM_API_KEY` and `JWT_SECRET` are set |
| Health endpoint returns 500 | Verify `FLARE_RPC_URL` is accessible from the SnapDeploy network |
| Feed endpoint returns 401 | Ensure JWT is valid and not expired; check `JWT_SECRET` matches |
| Payment flow fails | Verify `NEVERMINED_APP_ID`, `NEVERMINED_APP_SECRET`, and proxy URL are configured |
| Build fails | Check `Dockerfile` syntax; ensure `package.json` and `package-lock.json` are in the repo root |
| Cold start delay | SnapDeploy containers auto-sleep after inactivity; first request may take 10-30s |

## Production Deployment

For production, repeat the same steps but with these changes:

1. Use `live` credentials instead of `sandbox`
2. Set `NVM_ENVIRONMENT=live`
3. Use mainnet Flare RPC URL
4. Use mainnet FTSO feed IDs
5. Use your production wallet address for `RECEIVER_ADDRESS`
6. Set `NODE_ENV=production`
7. Configure a custom domain in SnapDeploy settings
8. Enable HTTPS (SnapDeploy provides this automatically)