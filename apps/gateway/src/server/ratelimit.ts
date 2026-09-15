type Bucket = { count: number; resetAt: number };

const PRUNE_EVERY = 512;

export type RateLimitResult = { allowed: boolean; retryAfterSec: number };

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private ops = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  check(key: string, now = Date.now()): RateLimitResult {
    if ((this.ops = (this.ops + 1) % PRUNE_EVERY) === 0) this.prune(now);
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterSec: 0 };
    }
    if (bucket.count >= this.limit) {
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
    }
    bucket.count += 1;
    return { allowed: true, retryAfterSec: 0 };
  }

  reset(key?: string): void {
    if (key) this.buckets.delete(key);
    else this.buckets.clear();
  }

  prune(now = Date.now()): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

export class EndpointLimiter {
  private readonly limiters = new Map<string, { perMinute: number; limiter: RateLimiter }>();

  check(endpointId: string, perMinute: number, key: string, now = Date.now()): RateLimitResult {
    if (!Number.isFinite(perMinute) || perMinute <= 0) {
      this.limiters.delete(endpointId);
      return { allowed: true, retryAfterSec: 0 };
    }
    let entry = this.limiters.get(endpointId);
    if (!entry || entry.perMinute !== perMinute) {
      entry = { perMinute, limiter: new RateLimiter(perMinute, 60_000) };
      this.limiters.set(endpointId, entry);
    }
    return entry.limiter.check(key, now);
  }

  reset(endpointId?: string): void {
    if (endpointId) this.limiters.delete(endpointId);
    else this.limiters.clear();
  }
}

export type AddressSource = { ip: string | null; trustProxy: boolean };

export function clientAddress(request: Request, source: AddressSource, fallback = "unknown"): string {
  if (source.trustProxy) {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
    const real = request.headers.get("x-real-ip")?.trim();
    if (real) return real;
  }
  return source.ip ?? fallback;
}
