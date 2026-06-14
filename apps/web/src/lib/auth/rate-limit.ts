/**
 * Minimal in-memory fixed-window rate limiter for auth endpoints.
 *
 * v1 only: this is per-process and resets on restart, so it does NOT protect a
 * multi-instance deployment. It raises the cost of online password guessing
 * and signup spam for a single instance. Before launch / horizontal scaling,
 * replace the backing store with Redis or an edge limiter (flagged for the
 * CEO/security review on JJC-5).
 */
interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();

export interface RateLimitResult {
  ok: boolean;
  retryAfterMs: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const existing = buckets.get(key);
  if (!existing || now >= existing.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterMs: 0 };
  }
  if (existing.count >= limit) {
    return { ok: false, retryAfterMs: existing.resetAt - now };
  }
  existing.count += 1;
  return { ok: true, retryAfterMs: 0 };
}

/** Opportunistically evict expired windows so the map can't grow unbounded. */
export function sweepRateLimits(now: number = Date.now()): void {
  for (const [key, win] of buckets) {
    if (now >= win.resetAt) buckets.delete(key);
  }
}
