import { jwtVerify } from "jose";
import type { Request, Response, NextFunction } from "express";

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is not set");
  }
  return new TextEncoder().encode(secret);
}

export interface JwtPayload {
  sub: string;
  iat: number;
  exp: number;
  [key: string]: unknown;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function requireJwt(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      success: false,
      error: "Missing or malformed Authorization header",
    });
    return;
  }

  const token = authHeader.slice(7);
  jwtVerify(token, getSecret(), { algorithms: ["HS256"] })
    .then(({ payload }) => {
      req.user = payload as JwtPayload;
      next();
    })
    .catch(() => {
      res.status(401).json({
        success: false,
        error: "Invalid or expired token",
      });
    });
}