import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { authRepo, type PulseDb } from "@pulse/db";
import { createTestDb, type TestDb } from "@pulse/db/testing";
import { SCRYPT_PARAMS } from "./config";
import { AuthError } from "./errors";
import { verifyPassword } from "./password";
import {
  authenticate,
  resolveSession,
  revokeSession,
  signUp,
} from "./service";
import { hashSessionToken } from "./tokens";

/**
 * Produce a scrypt hash with below-policy parameters (the old N=2^15), in the
 * same self-describing format the app stores. Used to simulate a legacy row so
 * we can assert rehash-on-login upgrades it (F3).
 */
function legacyHash(password: string): Promise<string> {
  const N = 2 ** 15;
  const r = 8;
  const p = 1;
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scryptCb(
      password.normalize("NFKC"),
      salt,
      32,
      { N, r, p, maxmem: SCRYPT_PARAMS.maxmem },
      (err, derived) => {
        if (err) reject(err);
        else
          resolve(
            ["scrypt", N, r, p, salt.toString("base64"), derived.toString("base64")].join(
              "$",
            ),
          );
      },
    );
  });
}

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

describe("rehash-on-login (F3)", () => {
  const LEGACY = {
    teamName: "Legacy Co",
    email: "legacy@acme.com",
    password: "legacy-password-1",
  };

  it("upgrades a below-policy hash after one successful login", async () => {
    const stored = await legacyHash(LEGACY.password);
    const created = await authRepo.createAccountWithUser(
      { teamName: LEGACY.teamName, email: LEGACY.email, passwordHash: stored },
      db,
    );
    expect(created.ok).toBe(true);

    // The seeded hash is genuinely on the old N=2^15 params.
    const before = await authRepo.findUserByEmail(LEGACY.email, db);
    expect(before?.passwordHash).toBe(stored);
    expect(before?.passwordHash?.split("$")[1]).toBe(String(2 ** 15));

    // One successful login triggers the transparent upgrade.
    await authenticate({ email: LEGACY.email, password: LEGACY.password }, db);

    const after = await authRepo.findUserByEmail(LEGACY.email, db);
    expect(after?.passwordHash).not.toBe(stored);
    expect(after?.passwordHash?.split("$")[1]).toBe(String(SCRYPT_PARAMS.N));
    // The upgraded hash still verifies the same password.
    expect(await verifyPassword(LEGACY.password, after!.passwordHash)).toBe(true);
  });

  it("leaves a current-params hash untouched after login", async () => {
    const issued = await signUp(
      { teamName: "Fresh Co", email: "fresh@acme.com", password: "fresh-password-1" },
      db,
    );
    const before = await authRepo.findUserByEmail("fresh@acme.com", db);
    await authenticate(
      { email: "fresh@acme.com", password: "fresh-password-1" },
      db,
    );
    const after = await authRepo.findUserByEmail("fresh@acme.com", db);
    expect(after?.passwordHash).toBe(before?.passwordHash);
    expect(issued.context.user.email).toBe("fresh@acme.com");
  });
});
