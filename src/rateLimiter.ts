export interface RateLimitEnv {
  RATE_LIMIT_MAX?: string;
  RATE_LIMIT_WINDOW_SECONDS?: string;
}

const MAX_DEFAULT = 100;
const WINDOW_SECONDS_DEFAULT = 60;

class SlidingWindowCounter {
  private readonly windowMs: number;
  private readonly max: number;
  private readonly hits: Map<string, number[]> = new Map();

  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  hit(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const window = (this.hits.get(key) ?? []).filter((t) => t > cutoff);

    if (window.length >= this.max) {
      this.hits.set(key, window);
      return false;
    }

    window.push(now);
    this.hits.set(key, window);
    return true;
  }
}

const limiters = new Map<string, SlidingWindowCounter>();

export function getRateLimiter(
  env: RateLimitEnv,
): SlidingWindowCounter {
  const max = Number(env.RATE_LIMIT_MAX) || MAX_DEFAULT;
  const windowSeconds =
    Number(env.RATE_LIMIT_WINDOW_SECONDS) || WINDOW_SECONDS_DEFAULT;
  const key = `${max}:${windowSeconds}`;

  let limiter = limiters.get(key);
  if (!limiter) {
    limiter = new SlidingWindowCounter(max, windowSeconds * 1000);
    limiters.set(key, limiter);
  }
  return limiter;
}

export function clientIp(headers: Headers): string {
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export function isRateLimited(
  env: RateLimitEnv,
  headers: Headers,
): boolean {
  return !getRateLimiter(env).hit(clientIp(headers));
}