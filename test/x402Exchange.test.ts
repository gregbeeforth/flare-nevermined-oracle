import { app } from "../src/worker.js";
import { jwtVerify } from "jose";

const JWT_SECRET = "test-jwt-secret";
const env = { JWT_SECRET };

function encodeX402(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function makeValidToken(overrides: Record<string, unknown> = {}): string {
  return encodeX402({
    x402Version: "1.0",
    accepted: {
      planId: "plan-123",
      extra: { agentId: "agent-456" },
    },
    ...overrides,
  });
}

async function exchange(authValue: string | undefined) {
  const headers: Record<string, string> = {};
  if (authValue !== undefined) headers.authorization = authValue;
  return app.request(
    "/api/v1/x402/exchange",
    {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    },
    env,
  );
}

describe("POST /api/v1/x402/exchange", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const res = await exchange(undefined);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      success: false,
      error: "Missing or malformed Authorization header",
    });
  });

  it("returns 401 when Authorization header is not Bearer", async () => {
    const res = await exchange("Basic abc123");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      success: false,
      error: "Missing or malformed Authorization header",
    });
  });

  it("returns 401 for a token that is not valid base64url JSON", async () => {
    const res = await exchange("Bearer invalid_x402_token");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      success: false,
      error: "Invalid x402 token",
    });
  });

  it("returns 401 when accepted claims are missing", async () => {
    const res = await exchange(`Bearer ${makeValidToken({ accepted: undefined })}`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      success: false,
      error: "Invalid x402 token: missing accepted claims",
    });
  });

  it("returns 401 when accepted.planId is missing", async () => {
    const res = await exchange(
      `Bearer ${makeValidToken({ accepted: { extra: { agentId: "agent-456" } } })}`,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      success: false,
      error: "Invalid x402 token: missing planId",
    });
  });

  it("returns 200 with a JWT for a valid x402 token", async () => {
    const res = await exchange(`Bearer ${makeValidToken()}`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { success: boolean; token: string };
    expect(body.success).toBe(true);
    expect(body.token).toEqual(expect.any(String));
    expect(body.token.split(".")).toHaveLength(3);
  });

  it("mints a 1h HS256 JWT carrying sub, planId and x402Version", async () => {
    const res = await exchange(`Bearer ${makeValidToken()}`);
    const body = (await res.json()) as { success: boolean; token: string };

    const { payload, protectedHeader } = await jwtVerify(
      body.token,
      new TextEncoder().encode(JWT_SECRET),
      { algorithms: ["HS256"] },
    );

    expect(protectedHeader.alg).toBe("HS256");
    expect(payload.sub).toBe("agent-456");
    expect(payload.planId).toBe("plan-123");
    expect(payload.x402Version).toBe("1.0");
    expect(payload.exp).toBeDefined();
    const nowMs = Date.now();
    const expMs = Number(payload.exp) * 1000;
    expect(expMs).toBeGreaterThan(nowMs);
    expect(expMs).toBeLessThanOrEqual(nowMs + 60 * 60 * 1000);
  });

  it("sets sub from accepted.extra.agentId, defaulting to 'unknown' when absent", async () => {
    const res = await exchange(
      `Bearer ${makeValidToken({ accepted: { planId: "plan-123" } })}`,
    );
    const body = (await res.json()) as { success: boolean; token: string };

    const { payload } = await jwtVerify(
      body.token,
      new TextEncoder().encode(JWT_SECRET),
      { algorithms: ["HS256"] },
    );
    expect(payload.sub).toBe("unknown");
  });
});