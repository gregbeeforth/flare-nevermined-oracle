# Monetization Gateway Migration Analysis — flare-nevermined-oracle

> Status: research only — no code changes.
> The Cloudflare Monetization Gateway was announced 2026-07-01 as a waitlist product and is **not yet generally available**. Exact rule syntax, header/proof injection behavior, workers.dev support, supported rails, and fees are not published. Treat everything below as provisional and re-verify against Cloudflare docs at GA.

## 1. Executive Summary

Cloudflare's Monetization Gateway is an edge payment engine that lets any resource behind Cloudflare — pages, datasets, APIs, MCP tools — be charged with usage-based pricing. Payments settle peer-to-peer in stablecoins over the open **x402** protocol; metering, the 402 handshake, and payment verification all happen at Cloudflare's edge, so the origin never builds a payments stack.

This worker (`flare-nevermined-oracle`) already implements a hand-rolled *seller-side* x402 flow: a consumer pays, receives an x402 access token from Nevermined, the worker exchanges it for a short-lived JWT, and `/api/v1/feed` is JWT-gated. The Monetization Gateway can replace the payment machinery (Nevermined purchase + exchange route + `JWT_SECRET`) with a configured edge rule while the worker keeps serving FTSO data.

The recommended path is a **hybrid** model: preserve the current "pay once → ~1h access" session JWT on `/api/v1/feed`, but move the payment boundary to a Gateway rule using a capped-authorization scheme (`upto` / `batch-settlement`). A fully native per-request `exact` variant is documented as an alternative.

## 2. Current Flow

```
Consumer Agent
  │ 1. purchases Nevermined plan, receives x402 access token
  ▼
Nevermined Proxy (issues x402 token; verify plan)        [get-x402-token.mjs]
  │
  ▼
POST /api/v1/x402/exchange                                [src/worker.ts:47]
  │  decodeX402Token() → require accepted.planId → mint 1h HS256 JWT
  ▼
GET /api/v1/feed  →  requireJwt  →  FlareConsumer → Flare RPC (FTSOv2)
  │                  [src/jwtAuth.ts:20]  [src/flareConsumer.ts]
  ▼
JSON feeds (FLR/USD, BTC/USD) + blockHeight + timestamp + requestId
```

Components involved:

| Component | Role | Location |
|---|---|---|
| `get-x402-token.mjs` | Buyer-side: creates a Nevermined delegation + fetches an x402 access token | repo script (not in runtime) |
| `POST /api/v1/x402/exchange` | Decodes x402 token, issues 1h HS256 JWT | `src/worker.ts:47-104` |
| `decodeX402Token()` | base64url → JSON decode | `src/worker.ts:29-41` |
| `requireJwt` | Verifies `Bearer` JWT (HS256, expiry) | `src/jwtAuth.ts:20-51` |
| `JWT_SECRET` | Signs/verifies all JWTs | binding / secret |
| `FlareConsumer.getOracleData()` | Reads FTSOv2 feeds via `ethers` | `src/flareConsumer.ts:159-173` |

## 3. Security Findings

Moving to the Gateway resolves two weaknesses in the current design:

1. **The exchange does not verify the x402 token signature.** `decodeX402Token()` (src/worker.ts:29-41) only base64url-decodes the token and the handler requires `accepted.planId` to be present (src/worker.ts:63-88). It never checks a signature or queries Nevermined. Anyone can fabricate
   `{"x402Version":"1.0","accepted":{"planId":"anything"}}`, exchange it for a valid JWT, and get ~1h of feed access **without ever paying**. The E2E script (`test-e2e-worker.sh:40`) even relies on this for local testing.
   The Gateway's `PAYMENT-SIGNATURE` verification happens against a facilitator (open, cryptographic), so a fabricated proof is not accepted.

2. **`JWT_SECRET` drift is an operational footgun.** If the minting and verifying values differ (e.g., local vs remote), every feed call 401s; rotation invalidates all outstanding JWTs (documented in `cloudflare-plan.md` 7.4). Moving payment enforcement to the edge removes the shared-secret contract entirely (or, in the hybrid model, keeps it only internal to the worker).

## 4. How the Gateway Maps Onto This Worker

| Current piece | Gateway counterpart |
|---|---|
| Nevermined plan / subscription purchase | Edge rule on a route with a price and a `payTo` wallet; `exact` (fixed price), `upto` (authorize max, settle actual), or `batch-settlement` scheme; settled in stablecoins |
| `POST /api/v1/x402/exchange` + `JWT_SECRET` | Gateway issues `402 Payment Required` + payment instructions; after the buyer pays and retries with `PAYMENT-SIGNATURE`, the edge verifies at the facilitator and forwards; no shared secret |
| `requireJwt` on `/api/v1/feed` | Edge enforcement (rule on `GET /api/v1/feed`). In the fully-native variant the worker can drop `requireJwt`; in the hybrid variant it stays |
| Proxy URL (`https://flare-nevermined-oracle.flare-oracle.workers.dev`) | Gateway rules apply to a route/zone. A bare `*.workers.dev` wildcard may not be monetizable — likely needs a custom domain (`oracle.example.com`) |
| `RECEIVER_ADDRESS` / `NEVERMINED_PAYMENT_CHAIN` | Wallet address configured in the rule; Base mainnet `eip155:8453`, USDC (matches current `NEVERMINED_PAYMENT_CHAIN = "base"`) |

Example planned Gateway capabilities (from the 2026-07-01 announcement):
- Charge per REST verb/route, e.g. `$0.01` per `GET` or `POST` to `/api/premium/*`.
- Variable pricing, e.g. up to `$2` for image generation depending on compute.
- 401→402 conversion: intercept origin 401 "Unauthorized" and return 402 + pricing instead.
- Managed via dashboard, Cloudflare API, or Terraform (expression-based rules).

## 5. Recommended Architecture (Hybrid)

Keep the session-JWT UX, move the payment boundary to the edge.

```
Consumer Agent
  │ 1. requests GET /api/v1/feed (no payment) → 402 + payment instructions
  ▼
Cloudflare Edge (Monetization Gateway rule on GET /api/v1/feed)
  │ 2. buyer pays stablecoin (Base, USDC) to seller wallet
  │    (scheme: upto / batch-settlement — authorize a max, settle actual per session)
  │ 3. retry with PAYMENT-SIGNATURE → edge verifies at facilitator
  ▼
Worker (origin) — GET /api/v1/feed
  │  requireJwt (session JWT, internal)  →  FlareConsumer  →  Flare RPC
  ▼
JSON feeds
```

Why hybrid:
- The feed is re-polled repeatedly by agents (per-block/oracle cadence). A full 402 handshake + facilitator round-trip on *every* call is wasteful and re-exposes agents to 402 handling on each poll.
- The current "pay once → ~1h access" model already matches the Gateway's `upto`/`batch-settlement` schemes (authorize a maximum, settle only actual usage), so the UX is preserved.
- If traffic is ever dominated by lightweight, high-frequency calls, flip the rule to per-request `exact` with no worker change.

Worker changes under hybrid: the `/api/v1/x402/exchange` route and `JWT_SECRET` minting need not exist anymore; the worker keeps `requireJwt` (with a secret only it knows) purely as an internal gate and to surface a 401 that the Gateway can convert to a 402. Simplest is to retire the exchange route and let the worker/JWT layer issue session tokens itself or rely on edge-attached proof headers.

### Alternative: Fully Native (per-request `exact`)

```
Agent → GET /api/v1/feed → 402 → pay (exact, e.g. $0.01) → retry w/ proof → feed
```

- Removes the exchange route, `JWT_SECRET`, `requireJwt`, and Nevermined from the runtime entirely.
- Each call is a paid handshake; no session reuse.
- Best chosen later only if per-call latency/cost tradeoff becomes favorable; it is a rule change, not a rewrite.

## 6. Configuration Sketch (Provisional)

Not GA; shown only to illustrate direction. A rule would select the route and set the price/payment instruction, e.g. (expression-pseudo):

```
Rule: GET http.host == "oracle.example.com" and http.request.uri.path == "/api/v1/feed"
Action: require x402 payment
  scheme:   upto            # or exact / batch-settlement
  price:    $0.10           # per-session max (upto) or fixed per-call (exact)
  network:  eip155:8453    # Base mainnet
  pays to:  <RECEIVER_ADDRESS wallet>
```

Managed via dashboard, Cloudflare API, or Terraform (e.g. a future `cloudflare_monetization_gateway`-style resource) so the paid endpoint is part of the infra config.

## 7. Unknowns / Open Questions (verify at GA)

- **Header/proof injection**: does the Gateway forward a proof-of-payment header/claim to the origin (so the worker can bind sessions and/or log payer), or is edge-only enforcement assumed? This decides how `requireJwt`/sessions behave in hybrid mode.
- **`*.workers.dev` support**: can a rule target a bare `*.workers.dev` route, or is a custom domain/zone required? (Announcement implies route/zone-level rules.)
- **Supported rails**: which stablecoins/chains does Cloudflare's facilitator support at launch? Announcement cites USDC / Open USD without mandating a chain.
- **JWT session behavior**: is there any managed "session/pass" concept, or must `upto`/`batch-settlement` be combined with our own session layer?
- **Fees & pricing**: Cloudflare's take, settlement timing, minimums, geo availability, beta terms — all unpublished.
- **401→402 conversion mechanics** and how it interacts with an existing JWT gate (our 401s vs. a missing-payment 402).

## 8. Impact & Rollout Path

### Impact if Gateway replaces the payment stack

| Item | Change |
|---|---|
| `src/worker.ts` | Retire `POST /api/v1/x402/exchange` and `decodeX402Token()`; keep `/api/v1/feed` (optionally keep `requireJwt` internally) |
| Bindings/secrets | `JWT_SECRET`, `NVM_API_KEY`, `NEVERMINED_APP_ID`, `NEVERMINED_APP_SECRET`, `RECEIVER_ADDRESS` removable at runtime (or scaled down to a single internal session secret) |
| `wrangler.toml` | `NEVERMINED_PAYMENT_CHAIN` removable; `[routes]` if moving to a custom domain |
| `get-x402-token.mjs`, `scripts/publishAsset.ts` | Dead at runtime (buyer-side: replaced by any x402 wallet/facilitator client) |
| Tests | `test/jwtAuth.test.ts`, `test/server.integration.test.ts` simplified/adjusted; E2E becomes agent → Gateway → worker |
| `test-e2e-worker.sh` | Rework to a plain `curl /api/v1/feed` expecting 402, then the paid retry |
| `@nevermined-io/payments` | Removable from the runtime bundle |

### Rollout phases

1. **Now** — join the Monetization Gateway waitlist; keep the current worker as-is (this doc is the migration blueprint).
2. **At early access** — stand up the Gateway on a staging custom domain/zone behind the same worker `dist`; run E2E against it without touching production.
3. **When stable** — add the feed route rule (start with `exact` at ~$0.00x/call or `upto` session max), migrate the worker (retire exchange), verify 402 → pay → prove → feed flow, then cut over the production zone and remove unused bindings.

## 9. Summary

The Monetization Gateway is the managed version of the exact pattern this worker already implements manually. Migrating buys facilitator-verified payment enforcement (fixing the forged-token gap), removes the Nevermined runtime dependency and `JWT_SECRET` operational friction, and keeps the worker's only job as serving verifiable FTSO data. Recommended hybrid model preserves the existing session-JWT UX until per-request economics justify a fully native `exact` setup.