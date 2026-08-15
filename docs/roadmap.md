# Roadmap — flare-nevermined-oracle

Planned and potential improvements, roughly ordered by effort.

## Easy Additions

### 1. Individual Feed Lookup Endpoint

`FlareConsumer.getFeed()` already exists but isn't exposed via HTTP. Add `GET /api/v1/feed/:feedId` for targeted queries.

**Effort:** Low — the `getFeed()` method is already implemented; just needs a new Hono route.

### 2. Query Parameter Filtering

Extend `GET /api/v1/feed` to accept `?feedIds=0x...,0x...` so clients can request specific feeds instead of all configured ones.

**Effort:** Low — parse query params in the existing route handler and pass filtered IDs to `getAllFeeds()`.

### 3. Feed Discovery Endpoint

A public `GET /api/v1/feeds` (no JWT required) that returns the list of configured feed IDs and their metadata (decimals, chain).

**Effort:** Low — return the `feedIds` array from the `FlareConsumer` instance.

### 4. Derived Feed Computation

Compute cross-pair rates server-side (e.g., `BTC/ETH = BTC/USD / ETH/USD`) using the existing `getFeed()` method.

**Effort:** Low — fetch two feeds and divide their values, scaling by decimals.

## Medium Effort

### 5. In-Memory Caching

Add a TTL-based cache layer in `FlareConsumer` to reduce RPC calls and improve response times. The singleton pattern makes this trivial.

**Effort:** Medium — add a simple `Map<string, { value: FeedResult; expiresAt: number }>` with a configurable TTL.

### 6. Rate Limiting

Add rate limiting to protect the `/api/v1/feed` endpoint from abuse.

**Effort:** Medium — add a rate-limiting middleware and configure limits per IP or per JWT subject.

### 7. Request Logging / Metrics

Add middleware for response time logging and Prometheus metrics (`http_requests_total`, `feed_query_duration`).

**Effort:** Medium — add a response-time tracking middleware and expose metrics on a separate endpoint.

### 8. Multi-Network Query

Accept a `chainId` query parameter to resolve `ContractRegistry` addresses for different networks (mainnet, Songbird, Coston) dynamically.

**Effort:** Medium — the `ContractRegistry` address resolution is already network-aware; just expose the chain ID selection via query params.

### 9. Retry Logic for RPC Calls

Public Coston2 RPC endpoints can rate-limit or temporarily go down. Retry logic with exponential backoff prevents transient failures from breaking tests and improves production reliability.

**Effort:** Medium — add backoff-based retries to `FlareConsumer` RPC calls.

### 10. `TestFtsoV2` Support in Tests

Coston2 has a `TestFtsoV2` contract with all `view` methods and no fees, unlike mainnet `FtsoV2` which has gas costs. Using `TestFtsoV2` in tests is cheaper, faster, and avoids consuming gas on the testnet.

**Effort:** Medium — add a test-only contract selector in `flareConsumer.ts`.

## Larger Additions

### 11. WebSocket / SSE Streaming

Stream live feed updates to clients using Server-Sent Events, leveraging the ~1.8s block latency of Flare.

**Effort:** Larger — add an SSE endpoint that polls `getOracleData()` on each new block and pushes updates to connected clients.

### 12. Admin / Diagnostics Endpoint

`GET /admin/health` that checks RPC connectivity, feed freshness, and contract resolution status.

**Effort:** Larger — add a new route that exercises `resolveFtsoV2Address()`, `getBlockHeight()`, and `getNetworkTimestamp()` and returns their status.

## CI / Test Infrastructure

- **Add `@integration` test tags** — isolate integration/E2E tests from unit tests in CI. Tagging lets CI run fast unit tests on every push and integration/E2E tests only on PRs or nightly builds.
- **CI pipeline** — add `npm run test:integration` and `npm run test:e2e` to GitHub Actions with the Coston2 RPC URL as a secret.
- **Nevermined `publish-asset` integration test** — mock or skip when `NVM_API_KEY` is missing so CI doesn't fail without real credentials.

## Design Notes

The codebase's stateless, singleton design and clean separation of `FlareConsumer` / `Hono API` / `JWT Auth` makes all of these natural extensions without refactoring. The `FlareConsumer` class is the single point of extension — new methods can be added there and exposed via new Hono routes in `src/worker.ts`.
