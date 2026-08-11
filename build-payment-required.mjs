import { buildPaymentRequired } from "@nevermined-io/payments";
import * as dotenv from "dotenv";

dotenv.config();

const planId = process.env.NVM_PLAN_ID;
const agentId = process.env.NVM_AGENT_ID;

if (!planId) {
  console.error("NVM_PLAN_ID is required");
  process.exit(1);
}
if (!agentId) {
  console.error("NVM_AGENT_ID is required");
  process.exit(1);
}

const paymentRequired = buildPaymentRequired(planId, {
  agentId,
  endpoint: "/api/v1/feed",
  httpVerb: "GET",
});

console.log(JSON.stringify(paymentRequired));
