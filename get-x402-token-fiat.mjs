import { Payments } from "@nevermined-io/payments";
import * as dotenv from "dotenv";

dotenv.config();

const nvm = await Payments.getInstance({
  nvmApiKey: process.env.NVM_API_KEY,
});

const methods = await nvm.delegation.listPaymentMethods();
const card = methods?.find((m) => m.type === "card");
if (!card) {
  console.error("No enrolled card found. Add one at nevermined.app first.");
  process.exit(1);
}

const { delegationId } = await nvm.delegation.createDelegation({
  provider: "stripe",
  providerPaymentMethodId: card.id,
  spendingLimitCents: 10000,
  durationSecs: 604800,
  currency: "usd",
});

const { accessToken } = await nvm.x402.getX402AccessToken(
  process.env.NVM_PLAN_ID,
  process.env.NVM_AGENT_ID,
  {
    scheme: "nvm:card-delegation",
    delegationConfig: { delegationId },
  },
);

console.log(accessToken);
