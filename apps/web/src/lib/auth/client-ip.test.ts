import { describe, it, expect } from "vitest";
import { clientKeyFromHeaders } from "./client-ip";
import { MemoryRateLimitStore, checkRateLimit } from "./rate-limit";

/** Build a header getter from a plain map, mirroring Headers#get semantics. */
function headerGetter(headers: Record<string, string>): (name: string) => string | null {
  return (name) => headers[name] ?? null;
}

describe("clientKeyFromHeaders", () => {
  it("trusts the right-most XFF hop over x-real-ip", () => {
    // x-real-ip is also client-settable; the right-most XFF hop is the value
    // written by the trusted proxy and wins.
    const get = headerGetter({
      "x-real-ip": "198.51.100.1",
      "x-forwarded-for": "1.2.3.4, 203.0.113.5",
    });
    expect(clientKeyFromHeaders(get)).toBe("203.0.113.5");
  });

  it("uses the right-most x-forwarded-for hop", () => {
    const get = headerGetter({
      "x-forwarded-for": "1.2.3.4, 203.0.113.5",
    });
    expect(clientKeyFromHeaders(get)).toBe("203.0.113.5");
  });

  it("never trusts the left-most (client-supplied) x-forwarded-for entry", () => {
    const get = headerGetter({
      "x-forwarded-for": "9.9.9.9, 203.0.113.5",
    });
    // 9.9.9.9 is attacker-prepended; the trusted hop is the right-most.
    expect(clientKeyFromHeaders(get)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip only when XFF is absent", () => {
    const get = headerGetter({ "x-real-ip": "203.0.113.7" });
    expect(clientKeyFromHeaders(get)).toBe("203.0.113.7");
  });

  it("falls back to 'unknown' when no forwarding headers are present", () => {
    expect(clientKeyFromHeaders(headerGetter({}))).toBe("unknown");
  });

  it("ignores empty/whitespace entries", () => {
    const get = headerGetter({ "x-forwarded-for": "1.2.3.4, , " });
    expect(clientKeyFromHeaders(get)).toBe("1.2.3.4");
  });

  it("normalizes case so one IPv6 client maps to one bucket", () => {
    expect(
      clientKeyFromHeaders(headerGetter({ "x-forwarded-for": "2001:DB8::1" })),
    ).toBe("2001:db8::1");
  });
});

describe("rate limiting is not reset by a spoofed/rotated x-forwarded-for", () => {
  it("keeps counting one client even as the left-most XFF rotates (x-real-ip present)", async () => {
    const store = new MemoryRateLimitStore(() => 1_000_000);
    const limit = 3;
    const windowMs = 1000;

    // The same real client makes 4 attempts, rotating the spoofable left-most
    // XFF entry every time to try to dodge the limiter. x-real-ip is constant.
    const spoofedHops = ["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4"];
    const results = [];
    for (const hop of spoofedHops) {
      const key = clientKeyFromHeaders(
        headerGetter({
          "x-real-ip": "203.0.113.5",
          "x-forwarded-for": `${hop}, 203.0.113.5`,
        }),
      );
      results.push(await checkRateLimit(store, `login:${key}`, limit, windowMs));
    }

    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
  });

  it("keeps counting one client as XFF rotates (no x-real-ip, right-most stable)", async () => {
    const store = new MemoryRateLimitStore(() => 2_000_000);
    const limit = 2;
    const windowMs = 1000;

    const headerSets = [
      "1.1.1.1, 203.0.113.9",
      "2.2.2.2, 203.0.113.9",
      "3.3.3.3, 203.0.113.9",
    ];
    const results = [];
    for (const xff of headerSets) {
      const key = clientKeyFromHeaders(headerGetter({ "x-forwarded-for": xff }));
      results.push(await checkRateLimit(store, `login:${key}`, limit, windowMs));
    }

    expect(results.map((r) => r.ok)).toEqual([true, true, false]);
  });
});
