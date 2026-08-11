import { Hono } from "hono";
import { cors } from "hono/cors";
import { SignJWT } from "jose";
import { createConsumer, type FlareConsumer } from "./flareConsumer.js";
import { requireJwt, type JwtPayload } from "./jwtAuth.js";

export interface Env {
  FLARE_RPC_URL?: string;
  FTSO_FEED_IDS?: string;
  JWT_SECRET: string;
  NODE_ENV?: string;
  NEVERMINED_PAYMENT_CHAIN?: string;
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

function decodeX402Token(token: string): Record<string, unknown> | null {
  try {
    const base64 = token
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(token.length + ((4 - (token.length % 4)) % 4), "=");
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

const app = new Hono<AppEnv>();

app.use("*", cors());

app.post("/api/v1/x402/exchange", async (c) => {
  try {
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

    const accepted = decoded.accepted as Record<string, unknown> | undefined;
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

app.get("/api/v1/feed", requireJwt, async (c) => {
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
