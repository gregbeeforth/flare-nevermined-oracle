import { Payments } from "@nevermined-io/payments";
import * as dotenv from "dotenv";

dotenv.config();

const nvm = await Payments.getInstance({
  nvmApiKey: process.env.NVM_API_KEY,
});

const planId = process.env.NVM_PLAN_ID;
const agentId = process.env.NVM_AGENT_ID;

if (!planId || !agentId) {
  console.error("NVM_PLAN_ID and NVM_AGENT_ID must be set in .env");
  process.exit(1);
}

const plan = await nvm.plans.getPlan(planId);
const scheme = plan.metadata?.plan?.x402Scheme ?? "nvm:erc4337";
console.error(`Plan scheme: ${scheme}`);

if (scheme === "nvm:card-delegation") {
  const methods = await nvm.delegation.listPaymentMethods({ provider: "stripe" });
  const active = methods.find((m) => m.status === "Active" && m.type === "card");
  if (!active) {
    console.error(
      "No active Stripe card payment method found. Add a card in the Nevermined App first.",
    );
    process.exit(1);
  }

  const { delegationId } = await nvm.delegation.createDelegation({
    provider: "stripe",
    providerPaymentMethodId: active.id,
    spendingLimitCents: 10000,
    durationSecs: 604800,
    currency: "usd",
    planId,
  });

  const { accessToken } = await nvm.x402.getX402AccessToken(planId, agentId, {
    scheme: "nvm:card-delegation",
    delegationConfig: { delegationId },
  });

  console.log(accessToken);
} else {
  const { delegationId } = await nvm.delegation.createDelegation({
    provider: "erc4337",
    spendingLimitCents: 10000,
    durationSecs: 604800,
    currency: "usdc",
    planId,
  });

  const { accessToken } = await nvm.x402.getX402AccessToken(planId, agentId, {
    delegationConfig: { delegationId },
  });

  console.log(accessToken);
}
