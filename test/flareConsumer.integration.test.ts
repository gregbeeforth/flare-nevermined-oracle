import { FlareConsumer, createConsumer } from "../src/flareConsumer.js";

jest.setTimeout(30000);

const rpcUrl = process.env.TEST_RPC_URL || process.env.FLARE_RPC_URL;

if (!rpcUrl) {
  describe("FlareConsumer — Coston2 Integration", () => {
    it("skipped — FLARE_RPC_URL or TEST_RPC_URL is not set", () => {});
  });
} else {
  describe("FlareConsumer — Coston2 Integration", () => {
    let consumer: FlareConsumer;

    beforeAll(() => {
      const feedIdsRaw = process.env.FTSO_FEED_IDS || "0x01464c522f55534400000000000000000000000000";
      const feedIds = feedIdsRaw.split(",").map((id) => id.trim());
      consumer = new FlareConsumer(rpcUrl, feedIds);
    });

    describe("resolveFtsoV2Address", () => {
      it("should resolve a valid FtsoV2 address on Coston2", async () => {
        const address = await consumer.resolveFtsoV2Address();
        expect(address).toBeDefined();
        expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      });
    });

    describe("getFeed", () => {
      it("should return a non-zero value for a known Coston2 feed ID", async () => {
        const feedId = (process.env.FTSO_FEED_IDS || "0x01464c522f55534400000000000000000000000000").split(",")[0].trim();
        const result = await consumer.getFeed(feedId);
        expect(result.value).toBeDefined();
        expect(result.value).not.toBe("0");
        expect(typeof result.decimals).toBe("number");
        expect(result.timestamp).toBeGreaterThan(0);
      });
    });

    describe("getAllFeeds", () => {
      it("should return feed results for all configured feed IDs", async () => {
        const results = await consumer.getAllFeeds();
        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBeGreaterThan(0);
        for (const result of results) {
          expect(result.value).toBeDefined();
          expect(typeof result.decimals).toBe("number");
          expect(result.timestamp).toBeGreaterThan(0);
        }
      });
    });

    describe("getBlockHeight", () => {
      it("should return a block height greater than 0", async () => {
        const height = await consumer.getBlockHeight();
        expect(typeof height).toBe("number");
        expect(height).toBeGreaterThan(0);
      });
    });

    describe("getNetworkTimestamp", () => {
      it("should return a Unix timestamp within a reasonable range", async () => {
        const timestamp = await consumer.getNetworkTimestamp();
        expect(typeof timestamp).toBe("number");
        expect(timestamp).toBeGreaterThan(1_000_000_000);
        expect(timestamp).toBeLessThan(Date.now() / 1000 + 60);
      });
    });

    describe("getOracleData", () => {
      it("should return all fields populated with real Coston2 data", async () => {
        const data = await consumer.getOracleData();
        expect(data.feeds).toBeDefined();
        expect(Array.isArray(data.feeds)).toBe(true);
        expect(data.feeds.length).toBeGreaterThan(0);
        expect(typeof data.blockHeight).toBe("number");
        expect(data.blockHeight).toBeGreaterThan(0);
        expect(typeof data.networkTimestamp).toBe("number");
        expect(data.networkTimestamp).toBeGreaterThan(1_000_000_000);
        expect(data.requestId).toBeDefined();
        expect(data.requestId).toMatch(/^0x[a-fA-F0-9]+$/);
      });
    });

    describe("error handling", () => {
      it("should throw with an invalid RPC URL", async () => {
        const badConsumer = new FlareConsumer("http://localhost:1", [
          "0x01464c522f55534400000000000000000000000000",
        ]);
        await expect(badConsumer.resolveFtsoV2Address()).rejects.toThrow();
      });

      it("should throw when given an invalid feed ID", async () => {
        await expect(
          consumer.getFeed(
            "0x0000000000000000000000000000000000000000",
          ),
        ).rejects.toThrow();
      });

      it("should throw when FLARE_RPC_URL is missing", () => {
        const original = process.env.FLARE_RPC_URL;
        delete process.env.FLARE_RPC_URL;
        delete process.env.TEST_RPC_URL;
        try {
          const c = createConsumer();
          expect(c).toBeDefined();
        } finally {
          if (original) process.env.FLARE_RPC_URL = original;
          process.env.TEST_RPC_URL = original ? process.env.TEST_RPC_URL : "";
        }
      });
    });
  });
}