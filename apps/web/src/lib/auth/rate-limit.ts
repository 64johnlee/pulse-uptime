/**
 * Fixed-window rate limiter for auth and other abuse-sensitive endpoints.
 *
 * The app deploys to Vercel serverless, where each request may run in a fresh
 * isolate. A per-process `Map` is therefore recycled constantly and CANNOT
 * enforce a limit across instances — online password guessing and signup spam
 * would be effectively unbounded (JJC-11 / JJC-10 finding B1).
 *
 * Production must use a SHARED store. When the Upstash Redis REST credentials
 * are present (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) the
 * limiter is backed by that shared store, keyed on a trusted client id. With no
 * shared store configured it falls back to an in-memory store — fine for local
 * dev and tests, but we log loudly in production because limits are then only
 * best-effort per isolate.
 *
 * Backend selection is deliberately dependency-free: we speak the Upstash REST
 * pipeline protocol over the global `fetch`, so there is no extra package to
 * install or keep patched, and the store is trivially mockable in tests.
 */

export interface RateLimitResult {
  /** True when the request is within the limit and may proceed. */
  ok: boolean;
  /** Milliseconds until the window resets (0 when allowed). */
  retryAfterMs: number;
}

/**
 * Minimal counter contract the limiter needs from a backing store. `hit`
 * atomically increments the counter for `key`, creating it with a TTL of
 * `windowMs` on the first hit of a window, and returns the post-increment count
 * plus the milliseconds remaining until the window resets.
 */
export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<{ count: number; resetMs: number }>;
}

/**
 * Decide whether a request is allowed. The (limit+1)th hit within a window is
 * rejected; the backing store owns counting and expiry so this stays pure.
 */
export async function checkRateLimit(
  store: RateLimitStore,
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const { count, resetMs } = await store.hit(key, windowMs);
  if (count > limit) {
    return { ok: false, retryAfterMs: resetMs };
  }
  return { ok: true, retryAfterMs: 0 };
}

// -- In-memory store (local dev / tests only) -------------------------------

interface MemoryWindow {
  count: number;
  resetAt: number;
}

/**
 * Per-process fixed-window store. NOT safe for multi-instance production — see
 * the module header. The clock is injectable so tests can drive window resets
 * deterministically.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, MemoryWindow>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  async hit(
    key: string,
    windowMs: number,
  ): Promise<{ count: number; resetMs: number }> {
    const t = this.now();
    const existing = this.buckets.get(key);
    if (!existing || t >= existing.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: t + windowMs });
      return { count: 1, resetMs: windowMs };
    }
    existing.count += 1;
    return { count: existing.count, resetMs: existing.resetAt - t };
  }

  /** Opportunistically evict expired windows so the map can't grow unbounded. */
  sweep(): void {
    const t = this.now();
    for (const [key, win] of this.buckets) {
      if (t >= win.resetAt) this.buckets.delete(key);
    }
  }
}

// -- Shared store (Upstash Redis REST) --------------------------------------

export interface UpstashStoreConfig {
  url: string;
  token: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

interface UpstashPipelineResult {
  result?: number | string | null;
  error?: string;
}

/**
 * Shared fixed-window store backed by Upstash Redis over its REST API.
 *
 * Each `hit` runs an ordered pipeline in a single round trip:
 *   1. INCR key            — atomically bump the window counter
 *   2. PEXPIRE key ms NX   — set the TTL only on the first hit of the window
 *   3. PTTL key            — read the remaining TTL for retry-after
 * Because the counter lives in Redis, every serverless isolate shares it, so a
 * rotating/spoofed client cannot reset another isolate's bucket.
 */
export class UpstashRateLimitStore implements RateLimitStore {
  private readonly url: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: UpstashStoreConfig) {
    this.url = config.url.replace(/\/+$/, "");
    this.token = config.token;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async hit(
    key: string,
    windowMs: number,
  ): Promise<{ count: number; resetMs: number }> {
    const commands = [
      ["INCR", key],
      ["PEXPIRE", key, String(windowMs), "NX"],
      ["PTTL", key],
    ];

    try {
      const res = await this.fetchImpl(`${this.url}/pipeline`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(commands),
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const payload = (await res.json()) as UpstashPipelineResult[];
      const incr = payload[0];
      const pttl = payload[2];
      if (incr?.error) {
        throw new Error(incr.error);
      }

      const count = Number(incr?.result);
      // A non-numeric counter means we cannot trust the result; treat as a
      // store error and fail closed below rather than silently allowing.
      if (!Number.isFinite(count)) {
        throw new Error(`non-numeric INCR result: ${String(incr?.result)}`);
      }

      const ttl = Number(pttl?.result ?? -1);
      const resetMs = ttl > 0 ? ttl : windowMs;
      return { count, resetMs };
    } catch (err) {
      // Fail CLOSED. This is a brute-force control: if the shared store is
      // unavailable we deny rather than re-open the limiter (which is exactly
      // the gap JJC-11 closes). The tradeoff is that a store outage briefly
      // blocks auth; that is acceptable for a security control and far safer
      // than silently allowing unbounded attempts.
      console.error(
        "[rate-limit] shared store error; failing closed (deny):",
        err instanceof Error ? err.message : err,
      );
      return { count: Number.MAX_SAFE_INTEGER, resetMs: windowMs };
    }
  }
}

// -- Default store selection ------------------------------------------------

let defaultStore: RateLimitStore | null = null;
let warnedFallback = false;

/**
 * Resolve the process-wide store: the shared Upstash store when configured,
 * otherwise the in-memory fallback (with a loud warning in production).
 */
export function getRateLimitStore(): RateLimitStore {
  if (defaultStore) return defaultStore;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    defaultStore = new UpstashRateLimitStore({ url, token });
    return defaultStore;
  }

  // No shared store. In production this almost always means a misconfiguration:
  // per-isolate memory does NOT enforce limits across serverless instances, so
  // we refuse to start the limiter rather than run silently insecure. A single-
  // instance/self-host deployment can explicitly opt in to memory limiting
  // (mirrors PULSE_ALLOW_PRIVATE_TARGETS in the worker).
  const allowInsecureMemory =
    process.env.RATE_LIMIT_ALLOW_INSECURE_MEMORY === "true";

  if (process.env.NODE_ENV === "production" && !allowInsecureMemory) {
    throw new Error(
      "[rate-limit] No shared store configured in production. Set " +
        "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or explicitly opt " +
        "into per-isolate in-memory limiting with " +
        "RATE_LIMIT_ALLOW_INSECURE_MEMORY=true (single-instance / self-host only).",
    );
  }

  if (process.env.NODE_ENV === "production" && !warnedFallback) {
    warnedFallback = true;
    console.error(
      "[rate-limit] Using per-isolate in-memory limiter via " +
        "RATE_LIMIT_ALLOW_INSECURE_MEMORY. Limits are NOT enforced across " +
        "instances — only safe for single-instance deployments.",
    );
  }

  defaultStore = new MemoryRateLimitStore();
  return defaultStore;
}

/** Reset the cached default store. Test-only. */
export function resetRateLimitStoreForTests(): void {
  defaultStore = null;
  warnedFallback = false;
}

/**
 * Enforce a limit for `key` using the process default store. This is the entry
 * point for call sites; it is async because the shared store is networked.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  return checkRateLimit(getRateLimitStore(), key, limit, windowMs);
}
