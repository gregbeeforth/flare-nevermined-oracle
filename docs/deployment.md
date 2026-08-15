# Deployment — flare-nevermined-oracle

The service runs as a stateless [Cloudflare Worker](https://developers.cloudflare.com/workers/). `npm run dev` starts a local `wrangler dev` instance; `npm run deploy` publishes to Workers.

## Prerequisites

| Requirement | Check |
|---|---|
| Node.js ≥ 18 (repo uses 20+) | `node --version` |
| `wrangler` installed | `npx wrangler --version` (devDependency) |
| Cloudflare account | Sign up at https://dash.cloudflare.com |
| Dependencies installed | `npm install` |

Verify the worker typechecks and bundles before anything else:

```bash
npm run typecheck        # shared/Node tsconfig
npm run typecheck:worker # Worker tsconfig (@cloudflare/workers-types)
npm run lint
npm test                 # unit + integration + E2E (some tests hit live Coston2 RPC)
npx wrangler deploy --dry-run   # bundles without deploying
```

Expected dry-run output shows the bundle size and the `[vars]` bindings.

## Local Development (wrangler dev)

Runs the Worker locally using the `[vars]` from `wrangler.toml`. Secrets are NOT available in local dev unless you provide them:

```bash
npm run dev                # wrangler dev (default port 8787)
npm run dev -- --port 3000 # pick a specific port
```

Verify locally:

```bash
curl http://localhost:8787/health                 # {"status":"ok","timestamp":"..."}
curl -i http://localhost:8787/api/v1/feed         # 401 (no JWT)
```

To exercise the JWT-gated `/api/v1/feed` locally, provide `JWT_SECRET` and mint a token:

```bash
JWT_SECRET=dev-secret npx wrangler dev &

TOKEN=$(node -e "
const { SignJWT } = require('jose');
new SignJWT({sub:'test'})
  .setProtectedHeader({alg:'HS256'})
  .setExpirationTime('1h')
  .sign(new TextEncoder().encode('dev-secret'))
  .then(t => console.log(t));
")
curl -H "Authorization: Bearer $TOKEN" http://localhost:8787/api/v1/feed
```

### Local x402 → JWT → feed flow

**1. Obtain an x402 token.** `get-x402-token.mjs` reads `NVM_API_KEY`, `NVM_PLAN_ID`, and `NVM_AGENT_ID` from `.env` (via `dotenv`), then fetches a real x402 access token and prints it to stdout. The script inspects the plan's `x402Scheme` and uses the matching delegation flow:

- **`nvm:card-delegation` (fiat/Stripe plan):** creates a 7-day Stripe card delegation (USD, $100 spending limit) using your enrolled card, then requests the token with the `nvm:card-delegation` scheme. **Prerequisite:** add a payment card in the [Nevermined App](https://nevermined.app) (Settings → Payment methods) so the script can find an `Active` Stripe card.
- **`nvm:erc4337` (crypto plan):** creates a 7-day erc4337 delegation (USDC, $100 spending limit) and requests the token with the default scheme.

```bash
X402_TOKEN=$(NVM_API_KEY="$NVM_API_KEY" NVM_PLAN_ID="$NVM_PLAN_ID" NVM_AGENT_ID="$NVM_AGENT_ID" node get-x402-token.mjs)
echo "${#X402_TOKEN} chars"   # a base64url blob
```

**2. Exchange it for a short-lived JWT.** POST it as a Bearer token to `/api/v1/x402/exchange`. The handler base64url-decodes the token, reconstructs the `paymentRequired` payload (`planId`, `agentId`, resource `/api/v1/feed`), and calls the Nevermined backend `/api/v1/x402/verify` (`src/x402.ts`) using `NVM_API_KEY`. Only when the backend confirms `isValid` does it settle the credits via `/api/v1/x402/settle` (reporting the execution to the Nevermined dashboard) and sign a fresh 1h HS256 JWT (payload: `sub` = `accepted.extra.agentId`, `planId`, `x402Version`) with `JWT_SECRET`:

```bash
curl -s -X POST http://localhost:8787/api/v1/x402/exchange \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $X402_TOKEN"
# → { "success": true, "token": "<1h HS256 JWT>" }
# Missing/malformed auth header, bad base64, missing accepted.planId,
# or failed payment verification → 401
# Failed credit settlement → 402
# Missing NVM_API_KEY on the worker → 500
```

> Local dev needs `NVM_API_KEY` configured for the worker (`NVM_API_KEY=... npx wrangler dev`, or in `.dev.vars`). Because verification is enforced, fabricating a token no longer works — the exchange step requires a real Nevermined-issued x402 token.

**3. Query the feed with the returned JWT:**

```bash
JWT=$(curl -s -X POST http://localhost:8787/api/v1/x402/exchange \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $X402_TOKEN" | jq -r '.token')
curl -s -H "Authorization: Bearer $JWT" http://localhost:8787/api/v1/feed | python3 -m json.tool
```

## Configuration

Two kinds of configuration:

**Plain variables** — declared under `[vars]` in `wrangler.toml`. Edit the file and redeploy to change them. Never commit real secrets here.

| `[vars]` key | Example value |
|---|---|
| `FLARE_RPC_URL` | `https://flare-api.flare.network/ext/C/rpc` (mainnet) or `https://coston2-api.flare.network/ext/C/rpc` (Coston2 testnet) |
| `FTSO_FEED_IDS` | Comma-separated bytes21 IDs (12 feeds: FLR/USD, BTC/USD, XRP/USD, ETH/USD, DOGE/USD, SOL/USD, LINK/USD, USDC/USD, USDT/USD, ADA/USD, AVAX/USD, BNB/USD) — see `wrangler.toml` |
| `NODE_ENV` | `production` |
| `NEVERMINED_PAYMENT_CHAIN` | `base` |

**Secrets** — set via `wrangler secret put`. They are encrypted at rest and never visible in the dashboard. Do this once per environment:

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put NVM_API_KEY
npx wrangler secret put NEVERMINED_APP_ID
npx wrangler secret put NEVERMINED_APP_SECRET
npx wrangler secret put RECEIVER_ADDRESS
```

Each command prompts for the value on stdin (or pipe it: `echo "$VALUE" | npx wrangler secret put JWT_SECRET`). Use a strong, randomly generated `JWT_SECRET` — it signs and verifies every JWT.

> ⚠️ The same `JWT_SECRET` must be used wherever JWTs are validated. If you rotate it, all outstanding JWTs become invalid.

There is no `PORT` — Workers have no listening port.

## Deploy

### Authenticate with Cloudflare

```bash
npx wrangler login
npx wrangler whoami   # confirm the authenticated account
```

### Deploy

```bash
npx wrangler deploy            # or: npm run deploy
```

Successful output includes the worker name, the deployed version, and the public URL, e.g.:

```
Uploaded flare-nevermined-oracle (3.02 sec)
Deployed flare-nevermined-oracle
https://flare-nevermined-oracle.<your-subdomain>.workers.dev
```

### Verify the Deployment

```bash
# Health (public)
curl -s https://flare-nevermined-oracle.<your-subdomain>.workers.dev/health

# Feed without JWT → expect 401
curl -s -i https://flare-nevermined-oracle.<your-subdomain>.workers.dev/api/v1/feed

# Feed with a valid JWT → expect 200 + feeds
TOKEN=$(node -e "
const { SignJWT } = require('jose');
new SignJWT({sub:'test'})
  .setProtectedHeader({alg:'HS256'})
  .setExpirationTime('1h')
  .sign(new TextEncoder().encode(process.env.JWT_SECRET))
  .then(t => console.log(t));
")
curl -s -H "Authorization: Bearer $TOKEN" \
  https://flare-nevermined-oracle.<your-subdomain>.workers.dev/api/v1/feed | python3 -m json.tool

# x402 → JWT exchange (expect 401 without a valid x402 token)
curl -s -X POST https://flare-nevermined-oracle.<your-subdomain>.workers.dev/api/v1/x402/exchange \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer invalid_x402_token"
```

Run the full E2E script once the worker URL is live:

```bash
./test-e2e-worker.sh
```

## Custom Domain and Routes (optional)

By default the worker is served from `*.workers.dev`. To serve it on a domain you control (requires a Cloudflare-managed zone):

```toml
# wrangler.toml
routes = [
  { pattern = "oracle.example.com", zone_name = "example.com" }
]
```

then `npx wrangler deploy` again. Alternatively add a Custom Domain via the Cloudflare dashboard (Workers → your worker → Settings → Domains & Routes). Cloudflare issues/attaches HTTPS automatically.

## Managing the Deployment

**View logs** (requires the deployed worker to have observability enabled — see `[observability]` in `wrangler.toml`):

```bash
npx wrangler tail
```

**List deployments / rollback**:

```bash
npx wrangler deployments list
npx wrangler rollback
```

`wrangler rollback` reverts to the previous stable deployment if a release misbehaves.

**Update plain vars**: edit `wrangler.toml` → `npx wrangler deploy`.
**Update secrets**: `npx wrangler secret put <NAME>` → redeploy is triggered automatically.

## Troubleshooting

| Issue | Likely cause | Fix |
|---|---|---|
| `JWT_SECRET is not set` / feed returns 500 | Secret missing or name mismatch | `npx wrangler secret put JWT_SECRET` and redeploy |
| Feed returns 401 with a valid token | `JWT_SECRET` differs between mint and worker | Re-put the same secret |
| `Unsupported chain ID` | `FLARE_RPC_URL` on an unsupported network (only 14, 114, 19, 16) | Point `FLARE_RPC_URL` at Flare/Coston2/Songbird/Coston |
| Feed values are zero | Wrong `FTSO_FEED_IDS` for the network | Use correct bytes21 feed IDs for mainnet vs Coston2 |
| x402 exchange returns 401/500 | Invalid/expired x402 token, failed payment verification, or missing `NVM_API_KEY`/`JWT_SECRET` | Re-obtain the token; set `NVM_API_KEY` secret; verify secret |
| `wrangler deploy` fails on bundling `crypto` | `ethers` Node `crypto` import | Ensure `compatibility_flags = ["nodejs_compat"]` is present |
| First request is slow | Cold start (large `ethers` bundle) | Expected; `[observability]` is enabled, consider caching the feed response |
| Cold start budget exceeded | Default Worker CPU/startup budget | Contact Cloudflare to raise `startup_timeout` (Workers paid plan) |

## Related

- [Architecture](architecture.md) — components and design decisions
- [Launch](launch.md) — production readiness checklist
- [Testing](testing.md) — test layers and the E2E payment flow
