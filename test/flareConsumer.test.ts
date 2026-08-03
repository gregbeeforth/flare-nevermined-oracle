import { createConsumer } from "../src/flareConsumer";

describe("createConsumer", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should use default RPC URL from env var", () => {
    process.env.FLARE_RPC_URL = "https://flare-api.flare.network/ext/C/rpc";
    process.env.FTSO_FEED_IDS =
      "0x01464c522f55534400000000000000000000000000,0x014254432f55534400000000000000000000000000";
    const consumer = createConsumer();
    expect(consumer).toBeDefined();
  });

  it("should parse multiple feed IDs from comma-separated env var", () => {
    process.env.FTSO_FEED_IDS =
      "0x01464c522f55534400000000000000000000000000,0x014254432f55534400000000000000000000000000";
    const ids = process.env.FTSO_FEED_IDS!.split(",").map((id) => id.trim());
    expect(ids).toHaveLength(2);
  });

  it("should use single default feed ID when env var is not set", () => {
    delete process.env.FTSO_FEED_IDS;
    const ids = "0x01464c522f55534400000000000000000000000000".split(",").map((id) => id.trim());
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe(
      "0x01464c522f55534400000000000000000000000000",
    );
  });
});