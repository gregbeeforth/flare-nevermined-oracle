# Architecture — flare-nevermined-oracle

## Overview

A stateless Cloudflare Worker that reads decentralized consensus-driven asset prices from the Flare Blockchain via FTSOv2, exposes them through a JWT-gated JSON API, and gates access using Nevermined Payments infrastructure with time-bound JWT tokens.

## Component Diagram

```
Consumer Agent → Nevermined Proxy → Hono Worker (worker.ts) → FlareConsumer (flareConsumer.ts) → Flare Blockchain (FTSOv2)
                                    ↑
                              JWT Auth (jwtAuth.ts)
```

## Components

### `FlareConsumer` (`src/flareConsumer.ts`)

- Creates an `ethers.JsonRpcProvider` connected to a Flare RPC endpoint
- Resolves `FtsoV2` contract address via `ContractRegistry.getContractAddressByName()`
- Reads FTSO price feeds (`getFeedById`, `getFeedsById`) — all `view` calls, no fees
- Provides `getOracleData()` as an end-to-end aggregator (feeds + block height + network timestamp + request ID)
- Network-aware: resolves `ContractRegistry` address per chain ID (14=Flare, 114=Coston2, 19=Songbird, 16=Coston)
- Singleton pattern: one consumer instance reused across all requests in `worker.ts`
- `createConsumer(rpcUrl, feedIds)` takes explicit arguments supplied from Worker bindings (no `process.env`)

### `Hono Worker` (`src/worker.ts`)

- Cloudflare Worker entry point built on [Hono](https://hono.dev)
- Three endpoints: `GET /api/v1/feed` (JWT-gated), `POST /api/v1/x402/exchange` (public), `GET /health` (public)
- `/api/v1/feed` calls `FlareConsumer.getOracleData()` and returns `{ success: true, data: OracleResponse }`
- `/api/v1/x402/exchange` decodes the base64url x402 token, extracts `accepted.planId` / `accepted.extra.agentId`, and issues a time-bound (1h) JWT
- `/health` returns `{ status: "ok", timestamp }` for liveness checks
- CORS enabled via `hono/cors`
- Configuration comes from Worker bindings (`env`), not `process.env`
- Singleton `FlareConsumer` created lazily on first request, reused across requests
- Requires `nodejs_compat` compatibility flag (ethers uses Node `crypto` primitives)

### `JWT Auth` (`src/jwtAuth.ts`)

- Hono middleware (`requireJwt`) that verifies `Authorization: Bearer <token>` headers
- Uses `jose`'s `jwtVerify` with `algorithms: ["HS256"]` restriction (prevents algorithm confusion attacks)
- Attaches decoded payload to request context (`c.set("user", payload)`)
- Returns 401 for missing/invalid/expired tokens
- Secret read from `c.env.JWT_SECRET`

### `Nevermined Payments` (external, via `@nevermined-io/payments`)

- Handles payment gating — consumers must pay to receive a JWT
- The `publish-asset` script (`scripts/publishAsset.ts`) registers the oracle feed as a Nevermined asset with a pay-per-access plan (Node-side, not part of the Worker bundle)
- The Nevermined proxy sits between the consumer and the Worker, issuing JWTs after payment verification

## Data Flow

1. Consumer Agent sends request to Nevermined Proxy
2. Nevermined Proxy verifies payment, issues a time-bound JWT
3. Consumer Agent sends request to `/api/v1/feed` with JWT in `Authorization` header
4. `requireJwt` middleware verifies JWT signature and expiry
5. `FlareConsumer.getOracleData()` queries Flare RPC → ContractRegistry → FtsoV2 contract
6. Response returned as JSON with feeds, block height, network timestamp, and request ID

## Test Architecture

| Test Type | File(s) | Approach | Speed |
|-----------|---------|----------|-------|
| Unit | `test/flareConsumer.test.ts`, `test/jwtAuth.test.ts`, `test/x402Exchange.test.ts` | Mock `ethers`; test Hono middleware and the exchange route via a minimal Hono app using `app.request()` | Fast |
| Integration | `test/flareConsumer.integration.test.ts` | Connect to real Coston2 RPC, test `FlareConsumer` methods against live blockchain | Slow |
| E2E | `test/server.integration.test.ts` | Drive the Hono app directly with `app.request()`, test full request/response cycle | Slow |

## Key Design Decisions

- **Stateless**: no database, no session store — all data comes from the blockchain
- **Singleton consumer**: one `FlareConsumer` instance reused across requests to avoid creating new `JsonRpcProvider` per request
- **Network-aware**: `ContractRegistry` address resolved per chain ID, not hardcoded
- **Coston2-first**: integration/E2E tests target Coston2 testnet (free, no real funds at risk)
- **Algorithm-restricted JWT**: `jwtVerify` enforces `HS256` only, preventing algorithm confusion attacks
- **Hono**: edge-native router that works on Workers (no `node:http` server) with routing ergonomics suitable for this API
- **`nodejs_compat`**: required so `ethers` can use Node `crypto` primitives inside workerd

## Related

- [Deployment](deployment.md) — how to run and deploy the Worker
- [Testing](testing.md) — test layers and the E2E payment flow
