import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { authRepo, type PulseDb } from "@pulse/db";
import { createTestDb, type TestDb } from "@pulse/db/testing";
import { AuthError } from "./errors";
import {
  authenticate,
  resolveSession,
  revokeSession,
  signUp,
} from "./service";
import { hashSessionToken } from "./tokens";

/**
 * End-to-end auth flow against a real (PGlite) Postgres, proving the JJC-5
 * success condition: a user can sign up, log out, and log back in, and data is
 * scoped to their account.
 *
 * scrypt is intentionally slow, so the suite gets a generous timeout.
 */
let handle: TestDb;
let db: PulseDb;

beforeEach(async () => {
  handle = await createTestDb();
  db = handle.db;
});

afterEach(async () => {
  await handle.close();
});

const ACME = {
  teamName: "Acme",
  email: "founder@acme.com",
  password: "acme-password-1",
};

describe("signUp", () => {
  it("creates an account + user and issues a resolvable session", async () => {
    const issued = await signUp(ACME, db);
    expect(issued.context.account.name).toBe("Acme");
    expect(issued.context.user.email).toBe("founder@acme.com");
    expect(issued.context.user.accountId).toBe(issued.context.account.id);

    const resolved = await resolveSession(issued.token, db);
    expect(resolved?.account.id).toBe(issued.context.account.id);
    expect(resolved?.user.email).toBe("founder@acme.com");
  });

  it("never stores the raw password", async () => {
    const issued = await signUp(ACME, db);
    const user = await authRepo.findUserByEmail("founder@acme.com", db);
    expect(user?.passwordHash).toBeTruthy();
    expect(user?.passwordHash).not.toContain(ACME.password);
    expect(user?.passwordHash?.startsWith("scrypt$")).toBe(true);
    expect(issued.context.account.id).toBeTruthy();
  });

  it("rejects a duplicate email (case-insensitive) without enumerating", async () => {
    await signUp(ACME, db);
    await expect(
      signUp({ ...ACME, email: "FOUNDER@acme.com" }, db),
    ).rejects.toMatchObject({ code: "email_taken" } satisfies Partial<AuthError>);
  });

  it("rejects weak input via validation", async () => {
    await expect(
      signUp({ teamName: "X", email: "bad", password: "short" }, db),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe("authenticate (log back in)", () => {
  it("logs in with correct credentials after signup + logout", async () => {
    const first = await signUp(ACME, db);
    // log out
    await revokeSession(first.token, db);
    expect(await resolveSession(first.token, db)).toBeNull();

    // log back in
    const second = await authenticate(
      { email: "founder@acme.com", password: ACME.password },
      db,
    );
    const resolved = await resolveSession(second.token, db);
    expect(resolved?.user.email).toBe("founder@acme.com");
    expect(resolved?.account.id).toBe(first.context.account.id);
  });

  it("rejects a wrong password", async () => {
    await signUp(ACME, db);
    await expect(
      authenticate({ email: "founder@acme.com", password: "wrong" }, db),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
  });

  it("rejects an unknown email with the same generic error", async () => {
    await expect(
      authenticate({ email: "nobody@nowhere.com", password: "whatever" }, db),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
  });
});

describe("account scoping / tenant isolation", () => {
  it("resolves each session only to its own account", async () => {
    const acme = await signUp(ACME, db);
    const globex = await signUp(
      { teamName: "Globex", email: "ceo@globex.com", password: "globex-pass-1" },
      db,
    );

    expect(acme.context.account.id).not.toBe(globex.context.account.id);

    const acmeResolved = await resolveSession(acme.token, db);
    const globexResolved = await resolveSession(globex.token, db);

    expect(acmeResolved?.account.name).toBe("Acme");
    expect(acmeResolved?.user.email).toBe("founder@acme.com");
    expect(globexResolved?.account.name).toBe("Globex");
    expect(globexResolved?.user.email).toBe("ceo@globex.com");

    // No cross-tenant leakage: Acme's token never resolves Globex's account.
    expect(acmeResolved?.account.id).not.toBe(globex.context.account.id);
    expect(globexResolved?.account.id).not.toBe(acme.context.account.id);
  });
});

describe("session lifecycle", () => {
  it("returns null for an expired session", async () => {
    const issued = await signUp(ACME, db);
    // Forge an already-expired session row for this user.
    const expiredToken = "expired-token-value";
    await authRepo.createSession(
      {
        userId: issued.context.user.id,
        tokenHash: hashSessionToken(expiredToken),
        expiresAt: new Date(Date.now() - 1000),
      },
      db,
    );
    expect(await resolveSession(expiredToken, db)).toBeNull();
  });

  it("returns null for an unknown token", async () => {
    expect(await resolveSession("never-issued", db)).toBeNull();
    expect(await resolveSession("", db)).toBeNull();
  });

  it("revokeSession invalidates a live session", async () => {
    const issued = await signUp(ACME, db);
    expect(await resolveSession(issued.token, db)).not.toBeNull();
    await revokeSession(issued.token, db);
    expect(await resolveSession(issued.token, db)).toBeNull();
  });
});
