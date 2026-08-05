import express, { Request, Response } from "express";
import cors from "cors";
import * as dotenv from "dotenv";
import { SignJWT } from "jose";
import { createConsumer } from "./flareConsumer.js";
import { requireJwt } from "./jwtAuth.js";

dotenv.config();

const PORT = parseInt(process.env.PORT || "3000", 10);
const NODE_ENV = process.env.NODE_ENV || "development";

const app = express();

app.use(cors());
app.use(express.json());

const consumer = createConsumer();

let payments: {
  facilitator: {
    verifyPermissions: (params: {
      paymentRequired: unknown;
      x402AccessToken: string;
    }) => Promise<{ isValid: boolean; invalidReason?: string }>;
  };
} | null = null;

async function initPayments(): Promise<void> {
  const nvmApiKey = process.env.NVM_API_KEY;
  if (!nvmApiKey) {
    console.warn("NVM_API_KEY not set — x402 verification will be skipped");
    return;
  }
  try {
    const { Payments } = await import(
      "@nevermined-io/payments"
    );
    const instance = await Payments.getInstance({ nvmApiKey });
    payments = instance as typeof payments;
  } catch (err) {
    console.warn("Failed to initialize Nevermined Payments SDK:", err);
  }
}

function decodeX402Token(token: string): Record<string, unknown> | null {
  try {
    const padded = token + "=".repeat((4 - token.length % 4) % 4);
    const decoded = Buffer.from(padded, "base64url").toString("utf-8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

app.post("/api/v1/x402/exchange", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({
        success: false,
        error: "Missing or malformed Authorization header",
      });
      return;
    }

    const x402Token = authHeader.slice(7);
    const decoded = decodeX402Token(x402Token);

    if (!decoded) {
      res.status(401).json({
        success: false,
        error: "Invalid x402 token",
      });
      return;
    }

    const accepted = decoded.accepted as Record<string, unknown> | undefined;
    if (!accepted) {
      res.status(401).json({
        success: false,
        error: "Invalid x402 token: missing accepted claims",
      });
      return;
    }

    const planId = accepted.planId as string | undefined;
    const extra = accepted.extra as Record<string, unknown> | undefined;
    const agentId = extra?.agentId as string | undefined;

    if (!planId) {
      res.status(401).json({
        success: false,
        error: "Invalid x402 token: missing planId",
      });
      return;
    }

    if (payments) {
      const { buildPaymentRequired } = await import(
        "@nevermined-io/payments"
      );
      const paymentRequired = buildPaymentRequired(planId, {
        agentId,
        endpoint: "/api/v1/feed",
        httpVerb: "GET",
      });

      const verification = await payments.facilitator.verifyPermissions({
        paymentRequired,
        x402AccessToken: x402Token,
      });

      if (!verification.isValid) {
        res.status(401).json({
          success: false,
          error: `x402 token verification failed: ${verification.invalidReason ?? "unknown reason"}`,
        });
        return;
      }
    }

    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const jwt = await new SignJWT({
      sub: agentId ?? "unknown",
      planId,
      x402Version: decoded.x402Version,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(secret);

    res.status(200).json({
      success: true,
      token: jwt,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

app.get("/api/v1/feed", requireJwt, async (req: Request, res: Response) => {
  try {
    const data = await consumer.getOracleData();

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

function startServer(): void {
  app.listen(PORT, async () => {
    await initPayments();
    console.log(`Flare Nevermined Oracle API running on port ${PORT}`);
    console.log(`Environment: ${NODE_ENV}`);
    console.log(`Feed endpoint: http://localhost:${PORT}/api/v1/feed`);
  });
}

export { app, startServer };

startServer();