import { ethers } from "ethers";

const CONTRACT_REGISTRY_ADDRESSES: Record<number, string> = {
  14: "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
  114: "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
  19: "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
  16: "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
};

const CONTRACT_REGISTRY_ABI = [
  "function getContractAddressByName(string calldata name) external view returns (address)",
];

const FTSO_V2_ABI = [
  "function getFeedByIdInWei(bytes21 _feedId) external view returns (uint256 value, uint64 timestamp)",
  "function getFeedsByIdInWei(bytes21[] calldata _feedIds) external view returns (uint256[] values, uint64 timestamp)",
  "function getFeedById(bytes21 _feedId) external view returns (uint256 value, int8 decimals, uint64 timestamp)",
  "function getFeedsById(bytes21[] calldata _feedIds) external view returns (uint256[] values, int8[] decimals, uint64 timestamp)",
];

export interface FeedResult {
  feedId: string;
  value: string;
  decimals: number;
  timestamp: number;
  valueInWei: string;
}

export interface OracleResponse {
  feeds: FeedResult[];
  blockHeight: number;
  networkTimestamp: number;
  requestId: string;
}

export class FlareConsumer {
  private provider: ethers.JsonRpcProvider;
  private feedIds: string[];
  private ftsoV2Address: string | null = null;

  constructor(rpcUrl: string, feedIds: string[]) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.feedIds = feedIds;
  }

  private async getChainId(): Promise<number> {
    const network = await this.provider.getNetwork();
    return Number(network.chainId);
  }

  private getContractRegistryAddress(chainId: number): string {
    const address = CONTRACT_REGISTRY_ADDRESSES[chainId];
    if (!address) {
      throw new Error(
        `Unsupported chain ID: ${chainId}. Supported: ${Object.keys(CONTRACT_REGISTRY_ADDRESSES).join(", ")}`,
      );
    }
    return address;
  }

  async resolveFtsoV2Address(): Promise<string> {
    if (this.ftsoV2Address) {
      return this.ftsoV2Address;
    }

    const chainId = await this.getChainId();
    const registryAddress = this.getContractRegistryAddress(chainId);

    const registry = new ethers.Contract(
      registryAddress,
      CONTRACT_REGISTRY_ABI,
      this.provider,
    );

    const address = await registry.getContractAddressByName("FtsoV2");
    if (!address) {
      throw new Error("Could not resolve FtsoV2 contract address");
    }

    this.ftsoV2Address = address;
    return this.ftsoV2Address!;
  }

  async getFeed(feedId: string): Promise<FeedResult> {
    const ftsoV2Address = await this.resolveFtsoV2Address();
    const ftsoV2 = new ethers.Contract(ftsoV2Address, FTSO_V2_ABI, this.provider);

    const [value, decimals, timestamp] =
      await ftsoV2.getFeedById(feedId as `0x${string}`);

    return {
      feedId,
      value: ethers.formatUnits(value, decimals),
      decimals: Number(decimals),
      timestamp: Number(timestamp),
      valueInWei: value.toString(),
    };
  }

  async getAllFeeds(): Promise<FeedResult[]> {
    const ftsoV2Address = await this.resolveFtsoV2Address();
    const ftsoV2 = new ethers.Contract(ftsoV2Address, FTSO_V2_ABI, this.provider);

    const formattedFeedIds = this.feedIds.map(
      (id) => id as `0x${string}`,
    );

    const [values, decodedDecimals, timestamp] =
      await ftsoV2.getFeedsById(formattedFeedIds);

    return this.feedIds.map((feedId, index) => ({
      feedId,
      value: ethers.formatUnits(values[index], Number(decodedDecimals[index])),
      decimals: Number(decodedDecimals[index]),
      timestamp: Number(timestamp),
      valueInWei: values[index].toString(),
    }));
  }

  async getBlockHeight(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  async getNetworkTimestamp(): Promise<number> {
    const block = await this.provider.getBlock("latest");
    if (!block) {
      throw new Error("Failed to fetch latest block");
    }
    return block.timestamp;
  }

  async getOracleData(): Promise<OracleResponse> {
    const feeds = await this.getAllFeeds();
    const blockHeight = await this.getBlockHeight();
    const networkTimestamp = await this.getNetworkTimestamp();

    return {
      feeds,
      blockHeight,
      networkTimestamp,
      requestId: ethers.hexlify(
        ethers.randomBytes(16),
      ),
    };
  }

  }

export function createConsumer(): FlareConsumer {
  const rpcUrl =
    process.env.FLARE_RPC_URL || "https://flare-api.flare.network/ext/C/rpc";
  const feedIdsRaw = process.env.FTSO_FEED_IDS || "0x01464c522f55534400000000000000000000000000";
  const feedIds = feedIdsRaw.split(",").map((id) => id.trim());

  return new FlareConsumer(rpcUrl, feedIds);
}