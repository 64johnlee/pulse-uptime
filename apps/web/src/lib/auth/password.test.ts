import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

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
    // U+00E9 (é) vs e + U+0301 (combining acute) — same NFKC form.
    const hash = await hashPassword("café");
    expect(await verifyPassword("café", hash)).toBe(true);
  });
});
