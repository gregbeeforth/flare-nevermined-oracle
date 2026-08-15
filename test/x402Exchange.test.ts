import { app } from "../src/worker.js";
import { jwtVerify } from "jose";

const JWT_SECRET = "test-jwt-secret";
const NVM_API_KEY = "sandbox:test-api-key";
const env = {
  JWT_SECRET,
  NVM_API_KEY,
  CORS_ORIGIN: "https://consumer.example.com",
};

function encodeX402(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function makeValidToken(overrides: Record<string, unknown> = {}): string {
  return encodeX402({
    x402Version: "1.0",
    accepted: {
      scheme: "nvm:erc4337",
      network: "eip155:84532",
      planId: "plan-123",
      extra: { agentId: "agent-456", httpVerb: "GET" },
    },
    ...overrides,
  });
}

function mockVerify(isValid: boolean, invalidReason?: string) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ isValid, ...(invalidReason ? { invalidReason } : {}) }),
  }) as unknown as typeof fetch;
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
  beforeEach(() => {
    mockVerify(true);
  });

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

  it("returns 401 when NVM_API_KEY is not configured", async () => {
    const res = await app.request(
      "/api/v1/x402/exchange",
      {
        method: "POST",
        headers: { authorization: `Bearer ${makeValidToken()}` },
        body: JSON.stringify({}),
      },
      { JWT_SECRET },
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      success: false,
      error: "x402 verification unavailable: NVM_API_KEY not configured",
    });
  });

  it("calls the Nevermined verify endpoint with the payment requirement", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ isValid: true }),
    }) as unknown as typeof fetch;

    await exchange(`Bearer ${makeValidToken()}`);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(String(url)).toBe(
      "https://api.sandbox.nevermined.app/api/v1/x402/verify",
    );
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${NVM_API_KEY}`,
    );

    const body = JSON.parse(String(init.body));
    expect(body.x402AccessToken).toBe(makeValidToken());
    expect(body.paymentRequired.accepts[0].planId).toBe("plan-123");
    expect(body.paymentRequired.accepts[0].extra.agentId).toBe("agent-456");
    expect(body.paymentRequired.resource.url).toBe("/api/v1/feed");
  });

  it("returns 401 when payment verification fails", async () => {
    mockVerify(false, "insufficient credits");
    const res = await exchange(`Bearer ${makeValidToken()}`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      success: false,
      error:
        "Invalid x402 token: payment verification failed (insufficient credits)",
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

  it("returns 429 when the rate limit is exceeded", async () => {
    const rateEnv = { JWT_SECRET, NVM_API_KEY, RATE_LIMIT_MAX: "1" };
    const first = await app.request(
      "/api/v1/x402/exchange",
      {
        method: "POST",
        headers: { authorization: `Bearer ${makeValidToken()}` },
        body: JSON.stringify({}),
      },
      rateEnv,
    );
    expect(first.status).toBe(200);

    const second = await app.request(
      "/api/v1/x402/exchange",
      {
        method: "POST",
        headers: { authorization: `Bearer ${makeValidToken()}` },
        body: JSON.stringify({}),
      },
      rateEnv,
    );
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({
      success: false,
      error: "Rate limit exceeded",
    });
  });
});