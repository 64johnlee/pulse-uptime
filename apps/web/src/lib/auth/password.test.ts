import { describe, it, expect } from "vitest";
import { SCRYPT_PARAMS } from "./config";
import { hashPassword, needsRehash, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies a correct password against its hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("Tr0ub4dor&3", hash)).toBe(false);
  });

  it("produces a unique salt per hash (no deterministic output)", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  it("uses the self-describing scrypt format", async () => {
    const hash = await hashPassword("x");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(hash.split("$")).toHaveLength(6);
  });

  it("returns false for a malformed stored hash instead of throwing", async () => {
    expect(await verifyPassword("whatever", "")).toBe(false);
    expect(await verifyPassword("whatever", "not-a-hash")).toBe(false);
    expect(await verifyPassword("whatever", "bcrypt$1$2$3$4")).toBe(false);
  });

  it("normalizes unicode so equivalent forms match", async () => {
    // U+00E9 (e-acute) vs e + U+0301 (combining acute) — same NFKC form.
    const precomposed = "café";
    const decomposed = "café";
    const hash = await hashPassword(precomposed);
    expect(await verifyPassword(decomposed, hash)).toBe(true);
  });
});

describe("needsRehash (F3)", () => {
  it("flags a hash whose N is below the current policy", () => {
    // A legacy 2^15 hash (params live in the string, so no real KDF needed).
    const legacy = `scrypt$${2 ** 15}$8$1$c2FsdA==$aGFzaA==`;
    expect(needsRehash(legacy)).toBe(true);
  });

  it("flags a hash whose r or p differs from the current policy", () => {
    const oddR = `scrypt$${SCRYPT_PARAMS.N}$4$1$c2FsdA==$aGFzaA==`;
    const oddP = `scrypt$${SCRYPT_PARAMS.N}$8$2$c2FsdA==$aGFzaA==`;
    expect(needsRehash(oddR)).toBe(true);
    expect(needsRehash(oddP)).toBe(true);
  });

  it("does not flag a freshly-created hash at current params", async () => {
    const hash = await hashPassword("current-params");
    expect(needsRehash(hash)).toBe(false);
  });

  it("never downgrades: a higher-N hash is not flagged", () => {
    const stronger = `scrypt$${SCRYPT_PARAMS.N * 2}$8$1$c2FsdA==$aGFzaA==`;
    expect(needsRehash(stronger)).toBe(false);
  });

  it("returns false for malformed hashes (nothing to upgrade)", () => {
    expect(needsRehash("")).toBe(false);
    expect(needsRehash("not-a-hash")).toBe(false);
    expect(needsRehash("scrypt$x$8$1$a$b")).toBe(false);
  });
});
