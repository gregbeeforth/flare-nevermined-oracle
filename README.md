# Verifiable Flare Oracle Feed on Nevermined

A stateless [Cloudflare Worker](https://developers.cloudflare.com/workers/) that reads decentralized consensus-driven asset prices from the Flare Blockchain via FTSOv2, exposes them through a JSON API, and gates access using Nevermined Payments infrastructure with time-bound JWT tokens.

## Architecture

```
Flare Blockchain RPC → FlareConsumer → Hono Worker → Nevermined Proxy → Consumer Agent
```

The Worker entry point is `src/worker.ts` (Hono). It reuses the same `FlareConsumer` and JWT auth modules as the original Express service, which was retired in favor of the Workers runtime.

## Setup

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

## Configuration

Configuration is provided through Cloudflare Worker bindings. Non-secret values live in `[vars]` in `wrangler.toml`; secrets are set with `wrangler secret put <NAME>`.

| Variable | Binding type | Description | Default |
|----------|--------------|-------------|---------|
| `FLARE_RPC_URL` | `[vars]` | Flare RPC endpoint | `https://flare-api.flare.network/ext/C/rpc` |
| `FTSO_FEED_IDS` | `[vars]` | Comma-separated FTSO feed IDs | FLR/USD |
| `NODE_ENV` | `[vars]` | Environment | `production` |
| `NEVERMINED_PAYMENT_CHAIN` | `[vars]` | Billing chain (e.g. base) | `base` |
| `JWT_SECRET` | secret | JWT signing secret | — |
| `NVM_API_KEY` | secret | Nevermined API key (publishing) | — |
| `NEVERMINED_APP_ID` | secret | Nevermined application ID | — |
| `NEVERMINED_APP_SECRET` | secret | Nevermined application secret | — |
| `RECEIVER_ADDRESS` | secret | Payment receiver address | — |

`PORT` is not needed — Workers have no listening port.

## Deploying to Cloudflare Workers

```bash
# 1. Authenticate
wrangler login

# 2. Set secrets (once per environment)
wrangler secret put JWT_SECRET
wrangler secret put NVM_API_KEY
wrangler secret put NEVERMINED_APP_ID
wrangler secret put NEVERMINED_APP_SECRET
wrangler secret put RECEIVER_ADDRESS

# 3. Deploy
npm run deploy        # wrangler deploy
```

The Worker is published to a `*.workers.dev` URL by default (custom domains and `[routes]` can be configured in `wrangler.toml`). Point the Nevermined proxy at this URL to gate the `/api/v1/feed` endpoint.

## Tests

```bash
npm test
```

## Local Testing

```bash
npm run dev   # wrangler dev with hot-reload
```