# Future Use Cases — flare-nevermined-oracle

## Easy Additions (leverage existing code)

### 1. Individual Feed Lookup Endpoint

`FlareConsumer.getFeed()` already exists but isn't exposed via HTTP. Add `GET /api/v1/feed/:feedId` for targeted queries.

**Effort:** Low — the `getFeed()` method is already implemented; just needs a new Express route.

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

Add `express-rate-limit` middleware to protect the `/api/v1/feed` endpoint from abuse.

**Effort:** Medium — add the middleware and configure limits per IP or per JWT subject.

### 7. Request Logging / Metrics

Add middleware for response time logging and Prometheus metrics (`http_requests_total`, `feed_query_duration`).

**Effort:** Medium — add a response-time tracking middleware and expose metrics on a separate endpoint.

### 8. Multi-Network Query

Accept a `chainId` query parameter to resolve `ContractRegistry` addresses for different networks (mainnet, Songbird, Coston) dynamically.

**Effort:** Medium — the `ContractRegistry` address resolution is already network-aware; just expose the chain ID selection via query params.

## Larger Additions

### 9. WebSocket / SSE Streaming

Stream live feed updates to clients using Server-Sent Events, leveraging the ~1.8s block latency of Flare.

**Effort:** Larger — add an SSE endpoint that polls `getOracleData()` on each new block and pushes updates to connected clients.

### 10. Admin / Diagnostics Endpoint

`GET /admin/health` that checks RPC connectivity, feed freshness, and contract resolution status.

**Effort:** Larger — add a new route that exercises `resolveFtsoV2Address()`, `getBlockHeight()`, and `getNetworkTimestamp()` and returns their status.

## Design Notes

The codebase's stateless, singleton design and clean separation of `FlareConsumer` / `Express API` / `JWT Auth` makes all of these natural extensions without refactoring. The `FlareConsumer` class is the single point of extension — new methods can be added there and exposed via new Express routes in `server.ts`.