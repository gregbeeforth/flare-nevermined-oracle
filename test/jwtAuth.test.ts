import { Hono } from "hono";
import { requireJwt, type JwtPayload } from "../src/jwtAuth.js";
import { SignJWT } from "jose";

const JWT_SECRET = "test-jwt-secret";

type TestEnv = {
  Bindings: { JWT_SECRET: string };
  Variables: { user?: JwtPayload };
};

function makeApp(): Hono<TestEnv> {
  const app = new Hono<TestEnv>();
  app.use("*", requireJwt);
  app.get("/", (c) => c.json({ ok: true, sub: c.get("user")?.sub }));
  return app;
}

async function makeToken(
  overrides: Record<string, unknown> = {},
  expiresIn = "1h",
): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return new SignJWT(overrides)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresIn)
    .sign(secret);
}

describe("requireJwt", () => {
  it("should return 401 when Authorization header is missing", async () => {
    const app = makeApp();
    const res = await app.request("/", undefined, { JWT_SECRET });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      success: false,
      error: "Missing or malformed Authorization header",
    });
  });

  it("should return 401 when Authorization header is not Bearer", async () => {
    const app = makeApp();
    const res = await app.request(
      "/",
      { headers: { authorization: "Basic abc123" } },
      { JWT_SECRET },
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      success: false,
      error: "Missing or malformed Authorization header",
    });
  });

  it("should return 401 when token is invalid", async () => {
    const app = makeApp();
    const res = await app.request(
      "/",
      { headers: { authorization: "Bearer invalid-token" } },
      { JWT_SECRET },
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      success: false,
      error: "Invalid or expired token",
    });
  });

  it("should return 401 when token is expired", async () => {
    const token = await makeToken({}, "-1s");
    const app = makeApp();
    const res = await app.request(
      "/",
      { headers: { authorization: `Bearer ${token}` } },
      { JWT_SECRET },
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      success: false,
      error: "Invalid or expired token",
    });
  });

  it("should pass through and attach payload when token is valid", async () => {
    const token = await makeToken({ sub: "user123" });
    const app = makeApp();
    const res = await app.request(
      "/",
      { headers: { authorization: `Bearer ${token}` } },
      { JWT_SECRET },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, sub: "user123" });
  });

  it("should return 401 when token has an invalid format", async () => {
    const app = makeApp();
    const res = await app.request(
      "/",
      { headers: { authorization: "Bearer definitely-not-a-jwt" } },
      { JWT_SECRET },
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      success: false,
      error: "Invalid or expired token",
    });
  });
});
