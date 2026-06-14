import { describe, it, expect } from "vitest";
import { generateSessionToken, hashSessionToken } from "./tokens";

describe("session tokens", () => {
  it("generates high-entropy, url-safe, unique tokens", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const token = generateSessionToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(token.length).toBeGreaterThanOrEqual(40);
      expect(seen.has(token)).toBe(false);
      seen.add(token);
    }
  });

  it("hashes deterministically (same token -> same hash)", () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it("produces different hashes for different tokens", () => {
    expect(hashSessionToken(generateSessionToken())).not.toBe(
      hashSessionToken(generateSessionToken()),
    );
  });

  it("emits a 64-char hex sha-256 digest", () => {
    expect(hashSessionToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
});
