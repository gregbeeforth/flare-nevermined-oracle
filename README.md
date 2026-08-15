# Verifiable Flare Oracle Feed on Nevermined

A stateless [Cloudflare Worker](https://developers.cloudflare.com/workers/) that reads decentralized consensus-driven asset prices from the Flare Blockchain via FTSOv2, exposes them through a JSON API, and gates access using Nevermined Payments infrastructure with time-bound JWT tokens.

## Architecture

```
Consumer Agent → Nevermined Proxy → Hono Worker → FlareConsumer → Flare RPC (FTSOv2)
                                    ↑
                              JWT Auth (jose, HS256)
```

The Worker entry point is `src/worker.ts` (Hono). It reuses the same `FlareConsumer` and JWT auth modules across the Hono app. See [docs/architecture.md](docs/architecture.md) for details.

## Quickstart

```bash
cd flare-nevermined-oracle
cp .env.example .env
npm install
npm run dev          # starts wrangler dev server
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/feed` | Returns FTSO price feeds with block height (JWT-gated) |
| POST | `/api/v1/x402/exchange` | Exchanges an x402 access token for a time-bound JWT |
| GET | `/health` | Health check |
| GET | `/.well-known/agent.json` | A2A Agent Card (discoverable agent definition) |

The Nevermined "Agent definition" metadata field can point at `https://flare-nevermined-oracle.flare-oracle.workers.dev/.well-known/agent.json`.

## Configuration

Configuration is provided through Cloudflare Worker bindings. Non-secret values live in `[vars]` in `wrangler.toml`; secrets are set with `wrangler secret put <NAME>`.

| Variable | Binding type | Description | Default |
|----------|--------------|-------------|---------|
| `FLARE_RPC_URL` | `[vars]` | Flare RPC endpoint | `https://flare-api.flare.network/ext/C/rpc` |
| `FTSO_FEED_IDS` | `[vars]` | Comma-separated FTSO feed IDs (bytes21) | `FLR/USD`, `BTC/USD`, `XRP/USD`, `ETH/USD`, `DOGE/USD`, `SOL/USD`, `LINK/USD`, `USDC/USD`, `USDT/USD`, `ADA/USD`, `AVAX/USD`, `BNB/USD` |
| `NODE_ENV` | `[vars]` | Environment | `production` |
| `NEVERMINED_PAYMENT_CHAIN` | `[vars]` | Billing chain (e.g. base) | `base` |
| `JWT_SECRET` | secret | JWT signing secret | — |
| `NVM_API_KEY` | secret | Nevermined API key (publishing) | — |
| `NEVERMINED_APP_ID` | secret | Nevermined application ID | — |
| `NEVERMINED_APP_SECRET` | secret | Nevermined application secret | — |
| `RECEIVER_ADDRESS` | secret | Payment receiver address | — |

Workers have no listening port, so there is no `PORT`.

## Deploy

```bash
# 1. Authenticate
npx wrangler login

# 2. Set secrets (once per environment)
npx wrangler secret put JWT_SECRET
npx wrangler secret put NVM_API_KEY
npx wrangler secret put NEVERMINED_APP_ID
npx wrangler secret put NEVERMINED_APP_SECRET
npx wrangler secret put RECEIVER_ADDRESS

# 3. Deploy
npm run deploy
```

The Worker is published to a `*.workers.dev` URL (e.g. `https://flare-nevermined-oracle.flare-oracle.workers.dev`). Point the Nevermined proxy at this URL to gate the `/api/v1/feed` endpoint.

## Tests

```bash
npm test
```

## Documentation

| Doc | Contents |
|-----|----------|
| [docs/architecture.md](docs/architecture.md) | Components, data flow, design decisions |
| [docs/deployment.md](docs/deployment.md) | Local dev, configuration, deploy, troubleshooting |
| [docs/launch.md](docs/launch.md) | Production readiness checklist |
| [docs/testing.md](docs/testing.md) | Test layers and the E2E payment flow |
| [docs/roadmap.md](docs/roadmap.md) | Planned improvements |
| [docs/monetization-gateway.md](docs/monetization-gateway.md) | Cloudflare Monetization Gateway migration research |
