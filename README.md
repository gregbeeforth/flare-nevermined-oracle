# Verifiable Flare Oracle Feed on Nevermined

A stateless Node.js service that reads decentralized consensus-driven asset prices from the Flare Blockchain via FTSOv2, exposes them through a JSON API, and gates access using Nevermined Payments infrastructure with time-bound JWT tokens.

## Architecture

```
Flare Blockchain RPC → FlareConsumer → Express API → Nevermined Proxy → Consumer Agent
```

## Setup

```bash
cd flare-nevermined-oracle
cp .env.example .env
npm install
npm run build
npm start
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/feed` | Returns FTSO price feeds with block height |
| GET | `/health` | Health check |

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `FLARE_RPC_URL` | Flare RPC endpoint | `https://flare-api.flare.network/ext/C/rpc` |
| `FTSO_FEED_IDS` | Comma-separated FTSO feed IDs | FLR/USD |
| `PORT` | API server port | `3000` |
| `NEVERMINED_APP_ID` | Nevermined application ID | — |
| `NEVERMINED_APP_SECRET` | Nevermined application secret | — |
| `NEVERMINED_PAYMENT_CHAIN` | Billing chain (e.g. base) | `base` |
| `JWT_SECRET` | JWT signing secret | — |

## Tests

```bash
npm test
```

## Local Testing

### 1. Setup

```bash
cp .env.example .env
# Edit .env: set FLARE_RPC_URL to Coston2, set JWT_SECRET, fill in feed IDs
npm install
npm run dev   # starts server with hot-reload on port 3000
```

### 2. Running Tests

```bash
npm test              # unit tests (mocked, fast)
npm run test:integration  # integration tests (real Coston2)
npm run test:e2e        # full E2E (server + live Flare)
```

### 3. Generate a Test JWT for Manual Curl Testing

```bash
node -e "const { SignJWT } = require('jose'); const s = new TextEncoder().encode(process.env.JWT_SECRET); SignJWT({sub:'test'}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(s).then(t => console.log(t))"
```

## Nevermined Asset Publishing

```bash
npm run publish-asset
```

Requires `NEVERMINED_APP_ID` and `NEVERMINED_APP_SECRET` to be set in `.env`.

## Development

```bash
npm run dev
```