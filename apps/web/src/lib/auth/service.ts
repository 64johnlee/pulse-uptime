import { authRepo, db as defaultDb, type PulseDb } from "@pulse/db";
import type { SessionContext } from "@pulse/db";
import { SESSION_TTL_MS } from "./config";
import { AuthError } from "./errors";
import { hashPassword, verifyPassword } from "./password";
import { generateSessionToken, hashSessionToken } from "./tokens";
import {
  logInSchema,
  signUpSchema,
  type LogInInput,
  type SignUpInput,
} from "./validation";

/**
 * Auth service — orchestration layer between the UI (server actions) and the
 * `@pulse/db` repository. Pure with respect to HTTP: it never touches cookies,
 * so it can be unit/integration tested directly against a PGlite database.
 *
 * Every function accepts an optional db handle for that reason; production
 * callers use the shared pooled client by default.
 */

export interface SessionIssue {
  /** Raw opaque token to place in the client cookie. Stored only as a hash. */
  token: string;
  expiresAt: Date;
  context: SessionContext;
}

/**
 * A fixed, valid scrypt hash used to equalize timing when an email does not
 * exist, so login response time does not leak account existence. The password
 * "x" never matches a real user's input in practice; the point is only to do
 * comparable KDF work. Computed once at module load.
 */
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) dummyHashPromise = hashPassword("invalid-placeholder");
  return dummyHashPromise;
}

async function issueSession(
  userId: string,
  account: SessionContext["account"],
  user: SessionContext["user"],
  dbh: PulseDb,
): Promise<SessionIssue> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const session = await authRepo.createSession(
    { userId, tokenHash: hashSessionToken(token), expiresAt },
    dbh,
  );
  return { token, expiresAt, context: { session, user, account } };
}

export async function signUp(
  raw: SignUpInput,
  dbh: PulseDb = defaultDb,
): Promise<SessionIssue> {
  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AuthError(
      "validation",
      parsed.error.issues[0]?.message ?? "Invalid input.",
    );
  }
  const { teamName, email, password } = parsed.data;

  const passwordHash = await hashPassword(password);
  const result = await authRepo.createAccountWithUser(
    { teamName, email, passwordHash },
    dbh,
  );
  if (!result.ok) {
    // Generic message — do not confirm which emails are registered.
    throw new AuthError(
      "email_taken",
      "That email can't be used. Try logging in instead.",
    );
  }

  return issueSession(result.user.id, result.account, result.user, dbh);
}

export async function authenticate(
  raw: LogInInput,
  dbh: PulseDb = defaultDb,
): Promise<SessionIssue> {
  const parsed = logInSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AuthError("invalid_credentials", "Invalid email or password.");
  }
  const { email, password } = parsed.data;

  const found = await authRepo.findUserWithAccountByEmail(email, dbh);
  if (!found) {
    // Equalize timing against the hash-verify path for a real user.
    await verifyPassword(password, await getDummyHash());
    throw new AuthError("invalid_credentials", "Invalid email or password.");
  }

  const ok = await verifyPassword(password, found.user.passwordHash);
  if (!ok) {
    throw new AuthError("invalid_credentials", "Invalid email or password.");
  }

  return issueSession(found.user.id, found.account, found.user, dbh);
}

/** Validate a raw session token (from the cookie) into a tenant context. */
export async function resolveSession(
  token: string,
  dbh: PulseDb = defaultDb,
): Promise<SessionContext | null> {
  if (!token) return null;
  const context = await authRepo.findActiveSessionWithUser(
    hashSessionToken(token),
    new Date(),
    dbh,
  );
  return context ?? null;
}

/** Revoke a single session (logout). */
export async function revokeSession(
  token: string,
  dbh: PulseDb = defaultDb,
): Promise<void> {
  if (!token) return;
  await authRepo.deleteSessionByTokenHash(hashSessionToken(token), dbh);
}
