import { Hono } from "hono";
import { cors } from "hono/cors";
import { SignJWT } from "jose";
import { createConsumer, type FlareConsumer } from "./flareConsumer.js";
import { requireJwt, type JwtPayload } from "./jwtAuth.js";
import {
  decodeX402Token,
  buildPaymentRequired,
  getNvmBackend,
  verifyX402Token,
} from "./x402.js";
import { isRateLimited } from "./rateLimiter.js";

export interface Env {
  FLARE_RPC_URL?: string;
  FTSO_FEED_IDS?: string;
  JWT_SECRET: string;
  NODE_ENV?: string;
  NEVERMINED_PAYMENT_CHAIN?: string;
  NVM_API_KEY?: string;
  CORS_ORIGIN?: string;
  RATE_LIMIT_MAX?: string;
  RATE_LIMIT_WINDOW_SECONDS?: string;
}

type AppEnv = {
  Bindings: Env;
  Variables: { user?: JwtPayload };
};

let consumer: FlareConsumer | null = null;

function getConsumer(env: Env): FlareConsumer {
  if (!consumer) {
    consumer = createConsumer(env.FLARE_RPC_URL, env.FTSO_FEED_IDS);
  }
  return consumer;
}

const app = new Hono<AppEnv>();

app.use("*", (c, next) => {
  const origin = c.env?.CORS_ORIGIN;
  if (origin) {
    return cors({ origin })(c, next);
  }
  return cors()(c, next);
});

app.post("/api/v1/x402/exchange", async (c) => {
  try {
    if (isRateLimited(c.env, c.req.raw.headers)) {
      return c.json(
        {
          success: false,
          error: "Rate limit exceeded",
        },
        429,
      );
    }

    const authHeader = c.req.header("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json(
        {
          success: false,
          error: "Missing or malformed Authorization header",
        },
        401,
      );
    }

    const x402Token = authHeader.slice(7);
    const decoded = decodeX402Token(x402Token);

    if (!decoded) {
      return c.json({
        success: false,
        error: "Invalid x402 token",
      }, 401);
    }

    const accepted = decoded.accepted as
      | {
          planId?: string;
          network?: string;
          scheme?: string;
          extra?: { agentId?: string; httpVerb?: string };
        }
      | undefined;
    if (!accepted) {
      return c.json({
        success: false,
        error: "Invalid x402 token: missing accepted claims",
      }, 401);
    }

    const planId = accepted.planId as string | undefined;
    const extra = accepted.extra as Record<string, unknown> | undefined;
    const agentId = extra?.agentId as string | undefined;

    if (!planId) {
      return c.json({
        success: false,
        error: "Invalid x402 token: missing planId",
      }, 401);
    }

    const nvmApiKey = c.env.NVM_API_KEY;
    if (!nvmApiKey) {
      return c.json({
        success: false,
        error: "x402 verification unavailable: NVM_API_KEY not configured",
      }, 500);
    }

    const paymentRequired = buildPaymentRequired(planId, {
      agentId,
      httpVerb: "GET",
      endpoint: "/api/v1/feed",
      network: accepted.network,
      scheme: accepted.scheme,
    });

    const verification = await verifyX402Token({
      backend: getNvmBackend(nvmApiKey),
      nvmApiKey,
      x402AccessToken: x402Token,
      paymentRequired,
    });

    if (!verification.isValid) {
      return c.json({
        success: false,
        error: `Invalid x402 token: payment verification failed${verification.invalidReason ? ` (${verification.invalidReason})` : ""}`,
      }, 401);
    }

    const secret = new TextEncoder().encode(c.env.JWT_SECRET);
    const jwt = await new SignJWT({
      sub: agentId ?? "unknown",
      planId,
      x402Version: decoded.x402Version,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(secret);

    return c.json({ success: true, token: jwt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ success: false, error: message }, 500);
  }
});

app.get("/api/v1/feed", (c, next) => {
  if (isRateLimited(c.env, c.req.raw.headers)) {
    return c.json(
      {
        success: false,
        error: "Rate limit exceeded",
      },
      429,
    );
  }
  return requireJwt(c, next);
}, async (c) => {
  try {
    const data = await getConsumer(c.env).getOracleData();
    return c.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ success: false, error: message }, 500);
  }
});

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

export { app };
export default app;