import { and, eq, gt, lt } from "drizzle-orm";
import { db as defaultDb, type PulseDb } from "../client";
import { accounts, sessions, users } from "../schema/auth";
import type { Account, Session, User } from "../schema/auth";

/**
 * Auth repository — the only place that talks to the auth tables.
 *
 * Storage concerns only: callers (the web app's auth service) own password
 * hashing, token generation, and validation. Every function accepts an
 * optional db handle so tests can inject a PGlite-backed instance; it defaults
 * to the shared pooled client.
 *
 * Account scoping: `findActiveSessionWithUser` resolves a session straight to
 * its owning user AND account in one query, so every request can derive the
 * tenant boundary from the session alone.
 */

export type CreateAccountWithUserResult =
  | { ok: true; account: Account; user: User }
  | { ok: false; reason: "email_taken" };

const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === PG_UNIQUE_VIOLATION
  );
}

/**
 * Create a tenant (account) and its first user atomically. The unique
 * constraint on users.email is the source of truth for "email already taken",
 * so we let the insert race and translate the violation rather than doing a
 * check-then-insert (which has a TOCTOU gap).
 */
export async function createAccountWithUser(
  input: { teamName: string; email: string; passwordHash: string },
  dbh: PulseDb = defaultDb,
): Promise<CreateAccountWithUserResult> {
  try {
    return await dbh.transaction(async (tx) => {
      const [account] = await tx
        .insert(accounts)
        .values({ name: input.teamName })
        .returning();
      if (!account) throw new Error("failed to create account");

      const [user] = await tx
        .insert(users)
        .values({
          accountId: account.id,
          email: input.email,
          passwordHash: input.passwordHash,
        })
        .returning();
      if (!user) throw new Error("failed to create user");

      return { ok: true as const, account, user };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, reason: "email_taken" };
    throw err;
  }
}

export async function findUserByEmail(
  email: string,
  dbh: PulseDb = defaultDb,
): Promise<User | undefined> {
  const [user] = await dbh
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return user;
}

/** Fetch a user and their owning account by email in a single query. */
export async function findUserWithAccountByEmail(
  email: string,
  dbh: PulseDb = defaultDb,
): Promise<{ user: User; account: Account } | undefined> {
  const [row] = await dbh
    .select({ user: users, account: accounts })
    .from(users)
    .innerJoin(accounts, eq(users.accountId, accounts.id))
    .where(eq(users.email, email))
    .limit(1);
  return row;
}

/**
 * Replace a user's stored password hash. Used for transparent rehash-on-login
 * when an existing hash was produced with below-policy scrypt parameters.
 */
export async function updateUserPasswordHash(
  userId: string,
  passwordHash: string,
  dbh: PulseDb = defaultDb,
): Promise<void> {
  await dbh.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

export async function createSession(
  input: { userId: string; tokenHash: string; expiresAt: Date },
  dbh: PulseDb = defaultDb,
): Promise<Session> {
  const [session] = await dbh
    .insert(sessions)
    .values({
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
    })
    .returning();
  if (!session) throw new Error("failed to create session");
  return session;
}

export interface SessionContext {
  session: Session;
  user: User;
  account: Account;
}

/**
 * Resolve a live (non-expired) session to its user and owning account. Returns
 * undefined for unknown or expired tokens.
 */
export async function findActiveSessionWithUser(
  tokenHash: string,
  now: Date,
  dbh: PulseDb = defaultDb,
): Promise<SessionContext | undefined> {
  const [row] = await dbh
    .select({ session: sessions, user: users, account: accounts })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .innerJoin(accounts, eq(users.accountId, accounts.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .limit(1);
  return row;
}

export async function deleteSessionByTokenHash(
  tokenHash: string,
  dbh: PulseDb = defaultDb,
): Promise<void> {
  await dbh.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

/** Housekeeping: drop expired sessions. Safe to call from a periodic job. */
export async function deleteExpiredSessions(
  now: Date,
  dbh: PulseDb = defaultDb,
): Promise<void> {
  await dbh.delete(sessions).where(lt(sessions.expiresAt, now));
}
