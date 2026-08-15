import { app, type Env } from "../src/worker.js";
import { SignJWT } from "jose";

const env: Env = {
  FLARE_RPC_URL: process.env.FLARE_RPC_URL,
  FTSO_FEED_IDS: process.env.FTSO_FEED_IDS,
  JWT_SECRET: process.env.JWT_SECRET || "test-jwt-secret",
};

async function makeToken(
  payload: Record<string, unknown> = { sub: "test" },
  expiresIn = "1h",
): Promise<string> {
  const secret = new TextEncoder().encode(env.JWT_SECRET);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresIn)
    .sign(secret);
}

describe("Worker E2E — Coston2 Integration", () => {
  describe("/health", () => {
    it("should return 200 with status ok (unauthenticated)", async () => {
      const res = await app.request("/health");
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: "ok" });
    });
  });

  describe("/.well-known/agent.json", () => {
    it("should return 200 with a valid A2A agent card (unauthenticated)", async () => {
      const res = await app.request("/.well-known/agent.json");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      const card = (await res.json()) as {
        "@context": string[];
        "@type": string;
        name: string;
        url: string;
        version: string;
        skills: unknown[];
        security: { authenticationSchemes: unknown[] };
      };
      expect(card["@context"]).toBeDefined();
      expect(card["@type"]).toBe("AgentCard");
      expect(card.name).toBe("Flare FTSO Oracle Feed");
      expect(card.url).toMatch(/^https:\/\//);
      expect(card.version).toBeDefined();
      expect(Array.isArray(card.skills)).toBe(true);
      expect(card.skills.length).toBeGreaterThan(0);
      expect(card.security.authenticationSchemes.length).toBeGreaterThan(0);
    });
  });

  describe("/api/v1/feed", () => {
    it("should return 401 without JWT", async () => {
      const res = await app.request("/api/v1/feed", undefined, env);
      expect(res.status).toBe(401);
    });

    it("should return 200 with real feed data for valid JWT", async () => {
      const token = await makeToken({ sub: "test" });
      const res = await app.request(
        "/api/v1/feed",
        { headers: { authorization: `Bearer ${token}` } },
        env,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: {
          feeds: unknown[];
          blockHeight: number;
          networkTimestamp: number;
          requestId: string;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data.feeds).toBeDefined();
      expect(Array.isArray(body.data.feeds)).toBe(true);
      expect(body.data.feeds.length).toBeGreaterThan(0);
      expect(body.data.blockHeight).toBeGreaterThan(0);
      expect(body.data.networkTimestamp).toBeGreaterThan(1_000_000_000);
      expect(body.data.requestId).toMatch(/^0x[a-fA-F0-9]+$/);
    });

    it("should return 401 for expired JWT", async () => {
      const token = await makeToken({ sub: "test" }, "-1s");
      const res = await app.request(
        "/api/v1/feed",
        { headers: { authorization: `Bearer ${token}` } },
        env,
      );
      expect(res.status).toBe(401);
    });

    it("should return 401 for malformed JWT", async () => {
      const res = await app.request(
        "/api/v1/feed",
        { headers: { authorization: "Bearer definitely-not-a-jwt" } },
        env,
      );
      expect(res.status).toBe(401);
    });
  });
});
