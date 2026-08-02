import * as dotenv from "dotenv";
import { Payments, type AgentAPIAttributes } from "@nevermined-io/payments";
dotenv.config();

const NVM_API_KEY = process.env.NVM_API_KEY || "";
const APP_ID = process.env.NEVERMINED_APP_ID || "";
const PAYMENT_CHAIN = process.env.NEVERMINED_PAYMENT_CHAIN || "base";
const RECEIVER_ADDRESS =
  process.env.RECEIVER_ADDRESS || "0x00000000000000000000000000000000000000";
const API_ENDPOINT = process.env.API_ENDPOINT || "http://localhost:3000/api/v1/feed";

async function main(): Promise<void> {
  if (!NVM_API_KEY) {
    console.error(
      "Missing NVM_API_KEY environment variable. Check .env file.",
    );
    process.exit(1);
  }

  console.log("Initializing Nevermined Payments SDK...");

  const nevermined = await Payments.getInstance({
    nvmApiKey: NVM_API_KEY,
    appId: APP_ID,
  });

  console.log("Querying Nevermined contract addresses...");

  const deploymentInfo = await nevermined.contracts.getDeploymentInfo();
  console.log(`Deployment info retrieved for chain: ${deploymentInfo.chainId}`);

  const payAsYouGoAddress =
    await nevermined.contracts.getPayAsYouGoTemplateAddress();
  console.log(`PayAsYouGoTemplate contract: ${payAsYouGoAddress}`);

  console.log("Registering Flare FTSO Oracle Feed asset with payment plan...");

  const agentMetadata = {
    name: "Flare FTSO Oracle Feed",
    description:
      "Verifiable Flare oracle price feed with time-bound JWT access via the /api/v1/feed endpoint.",
  };

  const agentApi: AgentAPIAttributes = {
    endpoints: [{ "GET": "/api/v1/feed" }],
    openEndpoints: ["/health"],
  };

  const planMetadata = {
    name: "Flare FTSO Oracle Feed Access",
    description:
      "Time-bound access to the verifiable Flare oracle price feed via the /api/v1/feed endpoint.",
    accessLimit: "time" as const,
  };

  const cryptoPriceConfig = nevermined.plans.getCryptoPriceConfig(
    BigInt(1_000_000),
    RECEIVER_ADDRESS as `0x${string}`,
  );

  const creditsConfig = nevermined.plans.getNonExpirableDurationConfig();

  const { agentId, planId } = await nevermined.agents.registerAgentAndPlan(
    agentMetadata,
    agentApi,
    planMetadata,
    cryptoPriceConfig,
    creditsConfig,
  );

  console.log(`Agent registered with ID: ${agentId}`);
  console.log(`Plan registered with ID: ${planId}`);
  console.log("Asset registration complete.");
  console.log(`API Endpoint: ${API_ENDPOINT}`);
  console.log(`Payment Chain: ${PAYMENT_CHAIN}`);
  console.log(`Plug the public tunnel URL into your Nevermined proxy configuration to gate the endpoint.`);
}

main().catch((error) => {
  console.error("Failed to publish asset:", error.message);
  process.exit(1);
});