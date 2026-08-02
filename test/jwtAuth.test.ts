import { requireJwt, JwtPayload } from "../src/jwtAuth";
import { SignJWT } from "jose";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET = "test-jwt-secret";

beforeAll(() => {
  process.env.JWT_SECRET = JWT_SECRET;
});

afterAll(() => {
  delete process.env.JWT_SECRET;
});

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 10));
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

function makeReq(headers: Record<string, string> = {}): Request {
  return { headers } as Request;
}

function makeRes(): Response {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as Response;
  return res;
}

function makeNext(): NextFunction {
  return jest.fn();
}

describe("requireJwt", () => {
  it("should return 401 when Authorization header is missing", () => {
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    requireJwt(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Missing or malformed Authorization header",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 401 when Authorization header is not Bearer", () => {
    const req = makeReq({ authorization: "Basic abc123" });
    const res = makeRes();
    const next = makeNext();

    requireJwt(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Missing or malformed Authorization header",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 401 when token is invalid", async () => {
    const req = makeReq({ authorization: "Bearer invalid-token" });
    const res = makeRes();
    const next = makeNext();

    requireJwt(req, res, next);
    await flush();

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Invalid or expired token",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 401 when token is expired", async () => {
    const token = await makeToken({}, "-1s");
    const req = makeReq({ authorization: `Bearer ${token}` });
    const res = makeRes();
    const next = makeNext();

    requireJwt(req, res, next);
    await flush();

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Invalid or expired token",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should call next() and attach payload when token is valid", async () => {
    const token = await makeToken({ sub: "user123" });
    const req = makeReq({ authorization: `Bearer ${token}` });
    const res = makeRes();
    const next = makeNext();

    requireJwt(req, res, next);
    await flush();

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect((req.user as JwtPayload).sub).toBe("user123");
  });

  it("should return 401 when token has an invalid format", async () => {
    const req = makeReq({ authorization: "Bearer definitely-not-a-jwt" });
    const res = makeRes();
    const next = makeNext();

    requireJwt(req, res, next);
    await flush();

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Invalid or expired token",
    });
    expect(next).not.toHaveBeenCalled();
  });
});