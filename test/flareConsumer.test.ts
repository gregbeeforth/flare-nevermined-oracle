import { FlareConsumer, createConsumer } from "../src/flareConsumer.js";

describe("createConsumer", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should use default RPC URL from env var", () => {
    process.env.FLARE_RPC_URL = "https://flare-api.flare.network/ext/C/rpc";
    process.env.FTSO_FEED_IDS =
      "0x01464c522f555344000000000000000000,0x014254432f555344000000000000000000";
    const consumer = createConsumer();
    expect(consumer).toBeDefined();
  });

  it("should parse multiple feed IDs from comma-separated env var", () => {
    process.env.FTSO_FEED_IDS =
      "0x01464c522f555344000000000000000000,0x014254432f555344000000000000000000";
    const ids = process.env.FTSO_FEED_IDS!.split(",").map((id) => id.trim());
    expect(ids).toHaveLength(2);
  });

  it("should use single default feed ID when env var is not set", () => {
    delete process.env.FTSO_FEED_IDS;
    const ids = "0x01464c522f555344000000000000000000".split(",").map((id) => id.trim());
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe(
      "0x01464c522f555344000000000000000000",
    );
  });
});

describe("normalizeFeedId", () => {
  it("should accept valid feed IDs", () => {
    const consumer = new FlareConsumer("http://localhost", [
      "0x01464c522f555344000000000000000000",
    ]);
    expect(consumer).toBeDefined();
  });

  it("should auto-correct x0 prefix to 0x", () => {
    const consumer = new FlareConsumer("http://localhost", [
      "x01464c522f555344000000000000000000",
    ]);
    expect(consumer).toBeDefined();
  });

  it("should reject feed IDs without 0x prefix", () => {
    expect(() => {
      new FlareConsumer("http://localhost", ["01464c522f555344000000000000000000"]);
    }).toThrow('Feed ID must start with "0x"');
  });

  it("should reject feed IDs with non-hex characters", () => {
    expect(() => {
      new FlareConsumer("http://localhost", ["0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ"]);
    }).toThrow("Feed ID contains non-hex characters");
  });

  it("should reject feed IDs exceeding bytes21 length", () => {
    const longFeedId = "0x" + "0".repeat(44);
    expect(() => {
      new FlareConsumer("http://localhost", [longFeedId]);
    }).toThrow("Feed ID exceeds bytes21 length");
  });

  it("should reject feed IDs with odd number of hex chars", () => {
    expect(() => {
      new FlareConsumer("http://localhost", ["0x01464c522f55534400000000000000000"]);
    }).toThrow("odd number of hex chars");
  });
});