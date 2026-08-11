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
