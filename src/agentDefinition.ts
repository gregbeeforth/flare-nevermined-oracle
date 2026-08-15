export interface A2AAgentCard {
  "@context": string[];
  "@type": string;
  name: string;
  description: string;
  url: string;
  version: string;
  documentationUrl?: string;
  provider: {
    organization: string;
    url?: string;
  };
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  security: {
    authenticationSchemes: Array<{
      scheme: string;
      credentialsFormat: string;
    }>;
  };
  skills: Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
    examples?: string[];
    inputModes: string[];
    outputModes: string[];
  }>;
}

export const a2aAgentCard: A2AAgentCard = {
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://a2a-protocol.org/latest/specification/agent-card.json",
  ],
  "@type": "AgentCard",
  name: "Flare FTSO Oracle Feed",
  description:
    "Verifiable Flare oracle price feed served via a JWT-gated JSON API. Reads decentralized consensus-driven asset prices from the Flare blockchain through FTSOv2 and gates access with time-bound JWTs issued after Nevermined payment verification.",
  url: "https://flare-nevermined-oracle.flare-oracle.workers.dev",
  version: "1.2.1",
  provider: {
    organization: "Flare Nevermined Oracle",
    url: "https://flare-nevermined-oracle.flare-oracle.workers.dev",
  },
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: false,
  },
  security: {
    authenticationSchemes: [
      {
        scheme: "bearer",
        credentialsFormat: "http_headers",
      },
    ],
  },
  skills: [
    {
      id: "ftso-price-feeds",
      name: "FTSO Price Feeds",
      description:
        "Returns current FTSOv2 price feeds for configured crypto assets (e.g. FLR/USD, BTC/USD, ETH/USD, XRP/USD) together with block height, network timestamp and a request ID.",
      tags: ["flare", "ftso", "oracle", "price-feed"],
      examples: [
        "What is the current FLR/USD price?",
        "Get BTC/USD and ETH/USD from the Flare oracle.",
      ],
      inputModes: ["text"],
      outputModes: ["json"],
    },
  ],
};
