import express, { Request, Response } from "express";
import cors from "cors";
import * as dotenv from "dotenv";
import { FlareConsumer, OracleResponse, createConsumer } from "./flareConsumer.js";
import { requireJwt } from "./jwtAuth.js";

dotenv.config();

const PORT = parseInt(process.env.PORT || "3000", 10);
const NODE_ENV = process.env.NODE_ENV || "development";

const app = express();

app.use(cors());
app.use(express.json());

const consumer = createConsumer();

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
  app.listen(PORT, () => {
    console.log(`Flare Nevermined Oracle API running on port ${PORT}`);
    console.log(`Environment: ${NODE_ENV}`);
    console.log(`Feed endpoint: http://localhost:${PORT}/api/v1/feed`);
  });
}

export { app, startServer };

startServer();