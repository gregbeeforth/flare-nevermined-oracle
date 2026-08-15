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
  global.fetch = jest.fn().mockImplementation((url: string | URL) => {
    if (String(url).endsWith("/api/v1/x402/verify")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          isValid,
          ...(invalidReason ? { invalidReason } : {}),
        }),
      });
    }
    if (String(url).endsWith("/api/v1/x402/settle")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ success: true, creditsRedeemed: "1" }),
      });
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      json: async () => ({}),
    });
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

  it("calls the Nevermined verify and settle endpoints with the payment requirement", async () => {
    global.fetch = jest.fn().mockImplementation((url: string | URL) => {
      if (String(url).endsWith("/api/v1/x402/verify")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ isValid: true, agentRequestId: "req-789" }),
        });
      }
      if (String(url).endsWith("/api/v1/x402/settle")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, creditsRedeemed: "1" }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }) as unknown as typeof fetch;

    await exchange(`Bearer ${makeValidToken()}`);

    const calls = (global.fetch as jest.Mock).mock.calls as [
      string | URL,
      RequestInit,
    ][];
    expect(calls).toHaveLength(2);

    const [verifyUrl, verifyInit] = calls[0];
    expect(String(verifyUrl)).toBe(
      "https://api.sandbox.nevermined.app/api/v1/x402/verify",
    );
    expect(verifyInit.method).toBe("POST");
    expect((verifyInit.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${NVM_API_KEY}`,
    );

    const verifyBody = JSON.parse(String(verifyInit.body));
    expect(verifyBody.x402AccessToken).toBe(makeValidToken());
    expect(verifyBody.paymentRequired.accepts[0].planId).toBe("plan-123");
    expect(verifyBody.paymentRequired.accepts[0].extra.agentId).toBe("agent-456");
    expect(verifyBody.paymentRequired.resource.url).toBe("/api/v1/feed");

    const [settleUrl, settleInit] = calls[1];
    expect(String(settleUrl)).toBe(
      "https://api.sandbox.nevermined.app/api/v1/x402/settle",
    );
    expect(settleInit.method).toBe("POST");
    expect((settleInit.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${NVM_API_KEY}`,
    );

    const settleBody = JSON.parse(String(settleInit.body));
    expect(settleBody.x402AccessToken).toBe(makeValidToken());
    expect(settleBody.agentRequestId).toBe("req-789");
    expect(settleBody.paymentRequired.resource.url).toBe("/api/v1/feed");
  });

  it("returns 402 when payment settlement fails", async () => {
    global.fetch = jest.fn().mockImplementation((url: string | URL) => {
      if (String(url).endsWith("/api/v1/x402/verify")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ isValid: true }),
        });
      }
      if (String(url).endsWith("/api/v1/x402/settle")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: false, errorReason: "insufficient credits" }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }) as unknown as typeof fetch;

    const res = await exchange(`Bearer ${makeValidToken()}`);
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      success: false,
      error: "x402 settlement failed (insufficient credits)",
    });
  });

  it("does not settle when payment verification fails", async () => {
    mockVerify(false, "insufficient credits");
    const res = await exchange(`Bearer ${makeValidToken()}`);
    expect(res.status).toBe(401);

    const settleCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([url]) => String(url).endsWith("/api/v1/x402/settle"),
    );
    expect(settleCalls).toHaveLength(0);
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