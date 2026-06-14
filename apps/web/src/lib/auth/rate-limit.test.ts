import { describe, it, expect } from "vitest";
import { rateLimit, sweepRateLimits } from "./rate-limit";

describe("rateLimit", () => {
  it("allows up to the limit, then blocks within the window", () => {
    const key = "test:a";
    const t0 = 1_000_000;
    expect(rateLimit(key, 3, 1000, t0).ok).toBe(true);
    expect(rateLimit(key, 3, 1000, t0).ok).toBe(true);
    expect(rateLimit(key, 3, 1000, t0).ok).toBe(true);
    const blocked = rateLimit(key, 3, 1000, t0);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets after the window elapses", () => {
    const key = "test:b";
    const t0 = 2_000_000;
    expect(rateLimit(key, 1, 1000, t0).ok).toBe(true);
    expect(rateLimit(key, 1, 1000, t0).ok).toBe(false);
    expect(rateLimit(key, 1, 1000, t0 + 1001).ok).toBe(true);
  });

  it("tracks keys independently", () => {
    const t0 = 3_000_000;
    expect(rateLimit("test:c", 1, 1000, t0).ok).toBe(true);
    expect(rateLimit("test:d", 1, 1000, t0).ok).toBe(true);
  });

  it("sweep does not throw", () => {
    expect(() => sweepRateLimits(9_999_999)).not.toThrow();
  });
});
