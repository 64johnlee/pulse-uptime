import { describe, it, expect } from "vitest";
import { logInSchema, signUpSchema } from "./validation";

describe("signUpSchema", () => {
  it("normalizes email (trim + lowercase)", () => {
    const parsed = signUpSchema.parse({
      teamName: "Acme",
      email: "  Founder@Acme.COM ",
      password: "longenough1",
    });
    expect(parsed.email).toBe("founder@acme.com");
  });

  it("rejects a short password", () => {
    const r = signUpSchema.safeParse({
      teamName: "Acme",
      email: "a@b.com",
      password: "short",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an invalid email", () => {
    const r = signUpSchema.safeParse({
      teamName: "Acme",
      email: "not-an-email",
      password: "longenough1",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty team name", () => {
    const r = signUpSchema.safeParse({
      teamName: "   ",
      email: "a@b.com",
      password: "longenough1",
    });
    expect(r.success).toBe(false);
  });
});

describe("logInSchema", () => {
  it("accepts any non-empty password (no policy on login)", () => {
    const r = logInSchema.safeParse({ email: "a@b.com", password: "x" });
    expect(r.success).toBe(true);
  });

  it("rejects an empty password", () => {
    const r = logInSchema.safeParse({ email: "a@b.com", password: "" });
    expect(r.success).toBe(false);
  });
});
