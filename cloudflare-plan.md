# Cloudflare Worker Deployment Plan — flare-nevermined-oracle

## Decisions

- **Routing**: Hono (edge-native, Express-like) replaces Express entirely
- **Dev/testing**: fully migrated to wrangler (`wrangler dev`; tests drive the Hono app via `app.request()`)
- **Layout**: flat — `src/worker.ts` + root `wrangler.toml`; shared `src/` modules reused unchanged where possible

## 1. Compatibility Analysis

| Component | Status | Action |
|---|---|---|
| `express` / `cors` | ❌ Node-only (`node:http` server, absent on Workers) | Replace with Hono + `hono/cors` |
| `dotenv` | ❌ Node-only | Worker bindings (`[vars]` / secrets); kept for Node-side scripts |
| `ethers` 6.17 | ⚠️ Main entry imports bare `crypto`, not `ws`; `JsonRpcProvider` uses global `fetch` | Enable `nodejs_compat` |
| `jose` 5.10 | ✅ Edge-native (Web Crypto) | No change |
| `@nevermined-io/payments` | ✅ Scripts only (`publishAsset.ts`, token scripts), not in runtime | No change |
| `Buffer.from(..., "base64url")` in `decodeX402Token` | ⚠️ Node API | Rewrite with `atob` + base64url → base64 mapping |
| `process.env` reads | ⚠️ `process` not available | Read from `env` binding passed by the fetch handler |

## 2. Target Architecture

```
Consumer Agent → Nevermined Proxy → Cloudflare Worker (Hono) → FlareConsumer (ethers) → Flare RPC
                                        ↑
                                  JWT auth (jose, HS256)
```

Single Worker entry `src/worker.ts` exposing a Hono app. Same three routes:

- `POST /api/v1/x402/exchange` — decode x402 token, issue time-bound JWT (1h)
- `GET /api/v1/feed` — JWT-gated FTSO data
- `GET /health` — public liveness check

## 3. File Changes

**New files**
- `wrangler.toml` — name, `main = "src/worker.ts"`, compatibility date, `compatibility_flags = ["nodejs_compat"]`, `[vars]`, `[observability]`
- `src/worker.ts` — Hono app (migrated from `server.ts`): three routes, `hono/cors`, lazy singleton consumer, `env`-based config
- `tsconfig.worker.json` — Worker-typed TS config (`@cloudflare/workers-types`, bundler resolution, `noEmit`)

**Modified files**
- `src/jwtAuth.ts` — convert Express middleware → Hono middleware (`Context`/`Next`); keep `algorithms: ["HS256"]` restriction; secret passed via `c.env.JWT_SECRET`
- `src/flareConsumer.ts` — `createConsumer(rpcUrl, feedIdsRaw)` accepts explicit args (no `process.env`)
- `package.json` — add `hono`, `wrangler`, `@cloudflare/workers-types`; remove `express`, `cors`, `@types/express`, `@types/cors`, `supertest`, `@types/supertest`; scripts: `dev: wrangler dev`, `deploy: wrangler deploy`, `typecheck`, `typecheck:worker`
- Tests — `test/server.integration.test.ts` drives `app.request()`; `test/jwtAuth.test.ts` tests the Hono middleware via a minimal Hono app
- `README.md` / `architecture.md` — document the Worker deploy path

**Deleted**
- `src/server.ts` (superseded by `src/worker.ts`)

**Kept (legacy/reference)**
- `Dockerfile`, `snapdeploy.toml`, `docker-compose.yml`, `snap_deploy.md` — previous deployment path, no longer the primary route

## 4. Environment Variable → Binding Mapping

| Current `.env` | Binding type | Notes |
|---|---|---|
| `FLARE_RPC_URL` | `[vars]` | |
| `FTSO_FEED_IDS` | `[vars]` | |
| `NODE_ENV` | `[vars]` | |
| `NEVERMINED_PAYMENT_CHAIN` | `[vars]` | |
| `JWT_SECRET` | secret | `wrangler secret put JWT_SECRET` |
| `NVM_API_KEY` | secret | |
| `NEVERMINED_APP_ID` | secret | |
| `NEVERMINED_APP_SECRET` | secret | |
| `RECEIVER_ADDRESS` | secret | |
| `PORT` | removed | Workers have no port |

## 5. Implementation Steps

1. Install tooling: `hono`, `wrangler`, `@cloudflare/workers-types`; remove Node-only runtime deps
2. Write `wrangler.toml`, `tsconfig.worker.json`
3. Write `src/worker.ts` (Hono app, three routes, cors, lazy singleton consumer, env plumbing, base64url decode)
4. Convert `src/jwtAuth.ts` to Hono middleware
5. Make `src/flareConsumer.ts` `createConsumer` arg-based
6. Delete `src/server.ts`; update `package.json` scripts
7. Rework `test/jwtAuth.test.ts` and `test/server.integration.test.ts` to `app.request()`
8. Verify: `npm run typecheck`, `npm run typecheck:worker`, `npm test`, `wrangler deploy --dry-run` (bundles)
9. Local run: `npm run dev` → verify `/health`, x402 exchange, feed with JWT
10. Deploy: `wrangler login`, `wrangler secret put` for each secret, `wrangler deploy`; verify `*.workers.dev`
11. Point the Nevermined proxy at the worker URL; re-run E2E checks from `nevermined_E2E.md`
12. Update `README.md` and `architecture.md`

## 6. Risks / Notes

- `ethers` bundle is large (~2 MB) → modest cold start; acceptable for this low-traffic, stateless service
- Keep a singleton `FlareConsumer` per isolate (matches current design; avoids creating a provider per request)
- `wrangler deploy` requires Node ≥ 18 (repo uses Node 20+) and a logged-in Cloudflare account
- If bundling fails on bare `crypto`, add esbuild externals / `main_fields` config (unlikely with `nodejs_compat`)
- Optional follow-ups: custom domain, `[routes]`, rate limiting, cache headers on the feed endpoint

## 7. Detailed Deployment Guide

### 7.1 Prerequisites

| Requirement | Check |
|---|---|
| Node.js ≥ 18 (repo uses 20+) | `node --version` |
| `wrangler` installed | `npx wrangler --version` (installed as devDependency) |
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

### 7.2 Local Development (wrangler dev)

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

To exercise JWT-gated `/api/v1/feed` locally, provide `JWT_SECRET` and mint a token:

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

For a full local x402 → JWT → feed flow (mirrors `test-e2e.sh` but against `localhost`), with `wrangler dev` running and `JWT_SECRET` set:

**1. Obtain an x402 token.** `get-x402-token.mjs` reads `NVM_API_KEY`, `NVM_PLAN_ID`, and `NVM_AGENT_ID` from `.env` (via `dotenv`), creates a 7-day erc4337 delegation (USDC, $100 spending limit) with Nevermined, then fetches a real x402 access token and prints it to stdout:

```bash
X402_TOKEN=$(NVM_API_KEY="$NVM_API_KEY" NVM_PLAN_ID="$NVM_PLAN_ID" NVM_AGENT_ID="$NVM_AGENT_ID" node get-x402-token.mjs)
echo "${#X402_TOKEN} chars"   # a ~202-char base64url blob
```

**2. Exchange it for a short-lived JWT.** POST it as a Bearer token to `/api/v1/x402/exchange`. The handler `decodeX402Token()` (src/worker.ts:29) base64url-decodes the token — **no signature check** — then requires an `accepted.planId` claim and signs a fresh 1h HS256 JWT (payload: `sub` = `accepted.extra.agentId`, `planId`, `x402Version`) with `JWT_SECRET`:

```bash
curl -s -X POST http://localhost:8787/api/v1/x402/exchange \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $X402_TOKEN"
# → { "success": true, "token": "<1h HS256 JWT>" }
# Missing/malformed auth header, bad base64, or missing accepted.planId → 401
```

**3. Query the feed with the returned JWT:**

```bash
JWT=$(curl -s -X POST http://localhost:8787/api/v1/x402/exchange \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $X402_TOKEN" | jq -r '.token')
curl -s -H "Authorization: Bearer $JWT" http://localhost:8787/api/v1/feed | python3 -m json.tool
```

**Local shortcut (no live Nevermined token needed):** because the exchange step only base64-decodes and checks for `accepted.planId`, you can fabricate a token locally to exercise the full chain without a delegation or payment:

```bash
FAKE=$(node -e "console.log(Buffer.from(JSON.stringify({x402Version:'1.0',accepted:{planId:'test-plan',extra:{agentId:'test-agent'}}})).toString('base64url'))")
curl -s -X POST http://localhost:8787/api/v1/x402/exchange \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FAKE" | jq -r '.token'
```

### 7.3 Authenticate with Cloudflare

```bash
npx wrangler login
npx wrangler whoami   # confirm the authenticated account
```

### 7.4 Set Environment Variables

Two kinds of configuration:

**Plain variables** — already declared under `[vars]` in `wrangler.toml`. Edit the file and redeploy to change them. Never commit real secrets here.

| `[vars]` key | Example value |
|---|---|
| `FLARE_RPC_URL` | `https://flare-api.flare.network/ext/C/rpc` (mainnet) or `https://coston2-api.flare.network/ext/C/rpc` (Coston2 testnet) |
| `FTSO_FEED_IDS` | `0x01464c522f55534400000000000000000000000000,0x014254432f55534400000000000000000000000000` (FLR/USD, BTC/USD) |
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

### 7.5 Deploy

```bash
npx wrangler deploy            # or: npm run deploy
```

Successful output includes the worker name, the deployed version, and the public URL, e.g.:

```
Uploaded flare-nevermined-oracle (3.02 sec)
Deployed flare-nevermined-oracle
https://flare-nevermined-oracle.<your-subdomain>.workers.dev
```

### 7.6 Verify the Deployment

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

Run the full E2E script once the worker URL is live (see 7.7).

### 7.7 Wire Up the Nevermined Proxy and E2E

1. In the [Nevermined dashboard](https://nevermined.app) → **Agents** → your Flare FTSO Oracle Feed agent → **Settings**, set the **proxy URL** to the deployed worker URL:
   ```
   https://flare-nevermined-oracle.<your-subdomain>.workers.dev
   ```
2. Point `test-e2e.sh` at the worker URL (`BASE_URL=...`) or set it via an env override, then run:
   ```bash
   ./test-e2e.sh
   ```
   This exercises the full purchase → x402 token → JWT → feed flow end to end.

### 7.8 Custom Domain and Routes (optional)

By default the worker is served from `*.workers.dev`. To serve it on a domain you control (requires a Cloudflare-managed zone):

```toml
# wrangler.toml
routes = [
  { pattern = "oracle.example.com", zone_name = "example.com" }
]
```

then `npx wrangler deploy` again. Alternatively add a Custom Domain via the Cloudflare dashboard (Workers → your worker → Settings → Domains & Routes). Cloudflare issues/attaches HTTPS automatically.

### 7.9 Managing the Deployment

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

### 7.10 Production Checklist

- [ ] `FLARE_RPC_URL` points to **mainnet** (`https://flare-api.flare.network/ext/C/rpc`), not Coston2
- [ ] `FTSO_FEED_IDS` uses **mainnet** feed IDs (bytes21, 42 hex chars)
- [ ] `JWT_SECRET` is a strong, unique secret
- [ ] Secrets (`NVM_API_KEY`, `NEVERMINED_APP_ID`, `NEVERMINED_APP_SECRET`, `RECEIVER_ADDRESS`) use live (`live:`) credentials
- [ ] `NODE_ENV` is `production`
- [ ] Nevermined agent proxy URL points at the worker URL
- [ ] CORS origins match your consumer domains (edit `cors()` in `src/worker.ts`)
- [ ] Custom domain + HTTPS configured (if required)

### 7.11 Troubleshooting

| Issue | Likely cause | Fix |
|---|---|---|
| `JWT_SECRET is not set` / feed returns 500 | Secret missing or name mismatch | `npx wrangler secret put JWT_SECRET` and redeploy |
| Feed returns 401 with a valid token | `JWT_SECRET` differs between mint and worker | Re-put the same secret |
| `Unsupported chain ID` | `FLARE_RPC_URL` on an unsupported network (only 14, 114, 19, 16) | Point `FLARE_RPC_URL` at Flare/Coston2/Songbird/Coston |
| Feed values are zero | Wrong `FTSO_FEED_IDS` for the network | Use correct bytes21 feed IDs for mainnet vs Coston2 |
| x402 exchange returns 401/500 | Invalid/expired x402 token or missing `JWT_SECRET` | Re-obtain the token; verify secret |
| `wrangler deploy` fails on bundling `crypto` | `ethers` Node `crypto` import | Ensure `compatibility_flags = ["nodejs_compat"]` is present |
| First request is slow | Cold start (large `ethers` bundle) | Expected; add `[observability]`, consider caching the feed response |
| Cold start budget exceeded | Default Worker CPU/startup budget | Contact Cloudflare to raise `startup_timeout` (Workers paid plan) |

