import request from "supertest";
import { app } from "../src/server.js";
import { SignJWT } from "jose";

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";

async function makeToken(
  payload: Record<string, unknown> = { sub: "test" },
  expiresIn = "1h",
): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresIn)
    .sign(secret);
}

describe("Server E2E — Coston2 Integration", () => {
  describe("/health", () => {
    it("should return 200 with status ok (unauthenticated)", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
    });
  });

  describe("/api/v1/feed", () => {
    it("should return 401 without JWT", async () => {
      const res = await request(app).get("/api/v1/feed");
      expect(res.status).toBe(401);
    });

    it("should return 200 with real feed data for valid JWT", async () => {
      const token = await makeToken({ sub: "test" });
      const res = await request(app)
        .get("/api/v1/feed")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.feeds).toBeInstanceOf(Array);
      expect(res.body.data.feeds.length).toBeGreaterThan(0);
      expect(res.body.data.blockHeight).toBeGreaterThan(0);
      expect(res.body.data.networkTimestamp).toBeGreaterThan(1_000_000_000);
      expect(res.body.data.requestId).toMatch(/^0x[a-fA-F0-9]+$/);
    });

    it("should return 401 for expired JWT", async () => {
      const token = await makeToken({ sub: "test" }, "-1s");
      const res = await request(app)
        .get("/api/v1/feed")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(401);
    });

    it("should return 401 for malformed JWT", async () => {
      const res = await request(app)
        .get("/api/v1/feed")
        .set("Authorization", "Bearer definitely-not-a-jwt");
      expect(res.status).toBe(401);
    });
  });
});