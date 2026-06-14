import { afterEach, describe, it, expect, vi } from "vitest";
import {
  MemoryRateLimitStore,
  UpstashRateLimitStore,
  checkRateLimit,
  getRateLimitStore,
  resetRateLimitStoreForTests,
} from "./rate-limit";

describe("MemoryRateLimitStore + checkRateLimit", () => {
  it("allows up to the limit, then blocks within the window", async () => {
    const store = new MemoryRateLimitStore(() => 1_000_000);
    const key = "test:a";
    expect((await checkRateLimit(store, key, 3, 1000)).ok).toBe(true);
    expect((await checkRateLimit(store, key, 3, 1000)).ok).toBe(true);
    expect((await checkRateLimit(store, key, 3, 1000)).ok).toBe(true);
    const blocked = await checkRateLimit(store, key, 3, 1000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets after the window elapses", async () => {
    let now = 2_000_000;
    const store = new MemoryRateLimitStore(() => now);
    const key = "test:b";
    expect((await checkRateLimit(store, key, 1, 1000)).ok).toBe(true);
    expect((await checkRateLimit(store, key, 1, 1000)).ok).toBe(false);
    now += 1001;
    expect((await checkRateLimit(store, key, 1, 1000)).ok).toBe(true);
  });

  it("tracks keys independently", async () => {
    const store = new MemoryRateLimitStore(() => 3_000_000);
    expect((await checkRateLimit(store, "test:c", 1, 1000)).ok).toBe(true);
    expect((await checkRateLimit(store, "test:d", 1, 1000)).ok).toBe(true);
  });

  it("sweep does not throw", () => {
    const store = new MemoryRateLimitStore(() => 9_999_999);
    expect(() => store.sweep()).not.toThrow();
  });
});

/**
 * Fake Upstash REST endpoint backed by plain Maps. Modeling the store as a
 * single shared object — rather than per-call state — is the whole point: it
 * stands in for the cross-isolate Redis that a serverless deployment shares.
 */
function makeFakeUpstash(): {
  fetchImpl: typeof fetch;
  calls: string[][][];
} {
  const counters = new Map<string, number>();
  const ttls = new Map<string, number>();
  const calls: string[][][] = [];

  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const commands = JSON.parse(String(init?.body)) as string[][];
    calls.push(commands);
    const results = commands.map((command) => {
      const [op, key, arg] = command as [string, string, string?];
      if (op === "INCR") {
        const next = (counters.get(key) ?? 0) + 1;
        counters.set(key, next);
        return { result: next };
      }
      if (op === "PEXPIRE") {
        // NX semantics: only set when no TTL exists yet.
        if (!ttls.has(key)) ttls.set(key, Number(arg));
        return { result: 1 };
      }
      if (op === "PTTL") {
        return { result: ttls.get(key) ?? -1 };
      }
      return { result: null };
    });
    return {
      ok: true,
      status: 200,
      json: async () => results,
    } as Response;
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

describe("UpstashRateLimitStore (shared store)", () => {
  const config = (fetchImpl: typeof fetch) => ({
    url: "https://example.upstash.io",
    token: "test-token",
    fetchImpl,
  });

  it("rejects the (N+1)th attempt for one key against the shared store", async () => {
    const { fetchImpl } = makeFakeUpstash();
    const store = new UpstashRateLimitStore(config(fetchImpl));
    const limit = 5;
    const windowMs = 15 * 60 * 1000;

    for (let i = 0; i < limit; i++) {
      const allowed = await checkRateLimit(store, "login:198.51.100.7", limit, windowMs);
      expect(allowed.ok).toBe(true);
    }

    const blocked = await checkRateLimit(store, "login:198.51.100.7", limit, windowMs);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(windowMs);
  });

  it("keeps independent buckets per key", async () => {
    const { fetchImpl } = makeFakeUpstash();
    const store = new UpstashRateLimitStore(config(fetchImpl));
    expect((await checkRateLimit(store, "login:a", 1, 1000)).ok).toBe(true);
    expect((await checkRateLimit(store, "login:a", 1, 1000)).ok).toBe(false);
    // A different key is unaffected by the first key's exhausted bucket.
    expect((await checkRateLimit(store, "login:b", 1, 1000)).ok).toBe(true);
  });

  it("sets the window TTL only once (PEXPIRE NX) so attempts can't extend it", async () => {
    const { fetchImpl, calls } = makeFakeUpstash();
    const store = new UpstashRateLimitStore(config(fetchImpl));
    await checkRateLimit(store, "login:c", 5, 1000);
    await checkRateLimit(store, "login:c", 5, 1000);
    expect(calls).toHaveLength(2);
    for (const commands of calls) {
      expect(commands[0]).toEqual(["INCR", "login:c"]);
      expect(commands[1]).toEqual(["PEXPIRE", "login:c", "1000", "NX"]);
      expect(commands[2]).toEqual(["PTTL", "login:c"]);
    }
  });

  it("fails CLOSED (denies) when the store transport errors", async () => {
    const failingFetch = (async () => ({
      ok: false,
      status: 500,
    }) as Response) as unknown as typeof fetch;
    const store = new UpstashRateLimitStore(config(failingFetch));
    const result = await checkRateLimit(store, "login:d", 5, 1000);
    expect(result.ok).toBe(false);
    expect(result.retryAfterMs).toBe(1000);
  });

  it("fails CLOSED when fetch rejects (network down)", async () => {
    const throwingFetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const store = new UpstashRateLimitStore(config(throwingFetch));
    const result = await checkRateLimit(store, "login:e", 5, 1000);
    expect(result.ok).toBe(false);
  });

  it("fails CLOSED when the counter is non-numeric (never silently allows)", async () => {
    const badFetch = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => [{ result: "not-a-number" }, { result: 1 }, { result: -1 }],
      }) as Response) as unknown as typeof fetch;
    const store = new UpstashRateLimitStore(config(badFetch));
    const result = await checkRateLimit(store, "login:f", 5, 1000);
    expect(result.ok).toBe(false);
  });
});

describe("getRateLimitStore (backend selection)", () => {
  afterEach(() => {
    resetRateLimitStoreForTests();
    vi.unstubAllEnvs();
  });

  it("selects the shared Upstash store when credentials are present", () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tkn");
    expect(getRateLimitStore()).toBeInstanceOf(UpstashRateLimitStore);
  });

  it("uses the in-memory fallback outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(getRateLimitStore()).toBeInstanceOf(MemoryRateLimitStore);
  });

  it("refuses to start in production without a shared store", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getRateLimitStore()).toThrow(/No shared store configured/);
  });

  it("allows opt-in in-memory limiting in production via env flag", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RATE_LIMIT_ALLOW_INSECURE_MEMORY", "true");
    expect(getRateLimitStore()).toBeInstanceOf(MemoryRateLimitStore);
  });
});
