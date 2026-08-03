import { Payments } from "@nevermined-io/payments";
import * as dotenv from "dotenv";

dotenv.config();

const nvm = await Payments.getInstance({
  nvmApiKey: process.env.NVM_API_KEY,
});

const { delegationId } = await nvm.delegation.createDelegation({
  provider: "erc4337",
  spendingLimitCents: 10000,
  durationSecs: 604800,
  currency: "usdc",
  planId: process.env.NVM_PLAN_ID,
});

const { accessToken } = await nvm.x402.getX402AccessToken(
  process.env.NVM_PLAN_ID,
  process.env.NVM_AGENT_ID,
  {
    delegationConfig: { delegationId },
  },
);

console.log(accessToken);