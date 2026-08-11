import { jwtVerify } from "jose";
import type { Context, Next } from "hono";

export interface JwtPayload {
  sub: string;
  iat: number;
  exp: number;
  [key: string]: unknown;
}

export interface AuthEnv {
  Bindings: { JWT_SECRET: string };
  Variables: { user?: JwtPayload };
}

function getSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export function requireJwt(
  c: Context<AuthEnv>,
  next: Next,
): Promise<Response | void> {
  const authHeader = c.req.header("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return Promise.resolve(
      c.json(
        {
          success: false,
          error: "Missing or malformed Authorization header",
        },
        401,
      ),
    );
  }

  const token = authHeader.slice(7);
  return jwtVerify(token, getSecret(c.env.JWT_SECRET), {
    algorithms: ["HS256"],
  })
    .then(({ payload }) => {
      c.set("user", payload as JwtPayload);
      return next();
    })
    .catch(() =>
      c.json({
        success: false,
        error: "Invalid or expired token",
      }, 401),
    );
}
