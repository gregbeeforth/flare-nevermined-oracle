# Architecture — flare-nevermined-oracle

## Overview

A stateless Node.js service that reads decentralized consensus-driven asset prices from the Flare Blockchain via FTSOv2, exposes them through a JWT-gated JSON API, and gates access using Nevermined Payments infrastructure with time-bound JWT tokens.

## Component Diagram

```
Consumer Agent → Nevermined Proxy → Express API (server.ts) → FlareConsumer (flareConsumer.ts) → Flare Blockchain (FTSOv2)
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
- Singleton pattern: one consumer instance reused across all requests in `server.ts`

### `Express API` (`src/server.ts`)

- Two endpoints: `/api/v1/feed` (JWT-gated) and `/health` (public)
- `/api/v1/feed` calls `FlareConsumer.getOracleData()` and returns `{ success: true, data: OracleResponse }`
- `/health` returns `{ status: "ok", timestamp }` for liveness checks
- CORS enabled, JSON body parsing
- `dotenv.config()` called once at module load
- Singleton `FlareConsumer` created at module level, reused across requests

### `JWT Auth` (`src/jwtAuth.ts`)

- Express middleware (`requireJwt`) that verifies `Authorization: Bearer <token>` headers
- Uses `jose`'s `jwtVerify` with `algorithms: ["HS256"]` restriction (prevents algorithm confusion attacks)
- Attaches decoded payload to `req.user` for downstream handlers
- Returns 401 for missing/invalid/expired tokens

### `Nevermined Payments` (external, via `@nevermined-io/payments`)

- Handles payment gating — consumers must pay to receive a JWT
- The `publish-asset` script (`scripts/publishAsset.ts`) registers the oracle feed as a Nevermined asset with a pay-per-access plan
- The Nevermined proxy sits between the consumer and the Express API, issuing JWTs after payment verification

## Data Flow

1. Consumer Agent sends request to Nevermined Proxy
2. Nevermined Proxy verifies payment, issues a time-bound JWT
3. Consumer Agent sends request to `/api/v1/feed` with JWT in `Authorization` header
4. `requireJwt` middleware verifies JWT signature and expiry
5. `FlareConsumer.getOracleData()` queries Flare RPC → ContractRegistry → FtsoV2 contract
6. Response returned as JSON with feeds, block height, network timestamp, and request ID

## Configuration

| Variable | Purpose | Required |
|----------|---------|----------|
| `FLARE_RPC_URL` | Flare C-chain RPC endpoint | Yes |
| `FTSO_FEED_IDS` | Comma-separated FTSO feed IDs to query | Yes |
| `JWT_SECRET` | Secret for signing/verifying JWTs | Yes |
| `PORT` | Express server port (default 3000) | No |
| `NODE_ENV` | Environment (development/integration) | No |
| `TEST_RPC_URL` | Override RPC URL for tests | No |
| `TEST_CHAIN_ID` | Override chain ID for tests | No |
| `NEVERMINED_APP_ID` | Nevermined app ID for asset publishing | No (publish only) |
| `NEVERMINED_APP_SECRET` | Nevermined app secret for asset publishing | No (publish only) |

## Test Architecture

| Test Type | File(s) | Approach | Speed |
|-----------|---------|----------|-------|
| Unit | `test/flareConsumer.test.ts`, `test/jwtAuth.test.ts` | Mock `ethers`, test env var parsing and JWT middleware | Fast |
| Integration | `test/flareConsumer.integration.test.ts` | Connect to real Coston2 RPC, test `FlareConsumer` methods against live blockchain | Slow |
| E2E | `test/server.integration.test.ts` | Spin up Express app, test full HTTP request/response cycle with `supertest` | Slow |

## Key Design Decisions

- **Stateless**: no database, no session store — all data comes from the blockchain
- **Singleton consumer**: one `FlareConsumer` instance reused across requests to avoid creating new `JsonRpcProvider` per request
- **Network-aware**: `ContractRegistry` address resolved per chain ID, not hardcoded
- **Coston2-first**: integration/E2E tests target Coston2 testnet (free, no real funds at risk)
- **Algorithm-restricted JWT**: `jwtVerify` enforces `HS256` only, preventing algorithm confusion attacks