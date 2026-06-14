import "dotenv/config";
import { randomBytes, scrypt, type ScryptOptions } from "node:crypto";
import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { getDatabaseUrl } from "./env";
import * as schema from "./schema/index";

/** Promise wrapper over the options form of scrypt (promisify's custom
 * overload doesn't resolve under this package's tsconfig). */
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * Dev seed: a sample tenant with a loginable user and a monitor.
 *
 * Idempotent — re-running is a no-op if the seed user already exists, so it is
 * safe to run repeatedly in local dev and in `pnpm db:verify`. Generic over the
 * Drizzle driver so the same logic runs against real Postgres (CLI below) and
 * the in-process PGlite used by verify.
 */
export const SEED_ACCOUNT_NAME = "Acme Inc";
export const SEED_USER_EMAIL = "founder@pulse.dev";
export const SEED_USER_PASSWORD = "password123";
export const SEED_MONITOR_NAME = "Acme Website";

/**
 * Reproduce the auth lib's scrypt format (`scrypt$N$r$p$salt$hash`) so the
 * seeded user can actually log in. Source of truth for these params and the
 * format is apps/web/src/lib/auth/{config,password}.ts (JJC-5); kept in sync
 * deliberately for the dev seed only — never used to verify real logins.
 */
async function hashPassword(password: string): Promise<string> {
  const N = 2 ** 15;
  const r = 8;
  const p = 1;
  const keylen = 32;
  const maxmem = 64 * 1024 * 1024;
  const salt = randomBytes(16);
  const derived = await scryptAsync(password.normalize("NFKC"), salt, keylen, {
    N,
    r,
    p,
    maxmem,
  });
  return ["scrypt", N, r, p, salt.toString("base64"), derived.toString("base64")].join("$");
}

export type SeedResult = {
  accountId: string;
  userId: string;
  monitorId: string;
  created: boolean;
};

export async function seed<TQuery extends PgQueryResultHKT>(
  db: PgDatabase<TQuery, typeof schema>,
): Promise<SeedResult> {
  const existing = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, SEED_USER_EMAIL))
    .limit(1);

  if (existing.length > 0) {
    const user = existing[0]!;
    const monitor = await db
      .select()
      .from(schema.monitors)
      .where(eq(schema.monitors.accountId, user.accountId))
      .limit(1);
    return {
      accountId: user.accountId,
      userId: user.id,
      monitorId: monitor[0]?.id ?? "",
      created: false,
    };
  }

  const [account] = await db
    .insert(schema.accounts)
    .values({ name: SEED_ACCOUNT_NAME })
    .returning();

  const [user] = await db
    .insert(schema.users)
    .values({
      accountId: account!.id,
      email: SEED_USER_EMAIL,
      passwordHash: await hashPassword(SEED_USER_PASSWORD),
    })
    .returning();

  const [monitor] = await db
    .insert(schema.monitors)
    .values({
      accountId: account!.id,
      name: SEED_MONITOR_NAME,
      type: "http",
      target: "https://example.com",
      intervalSeconds: 60,
    })
    .returning();

  return {
    accountId: account!.id,
    userId: user!.id,
    monitorId: monitor!.id,
    created: true,
  };
}

async function main() {
  const pool = new pg.Pool({ connectionString: getDatabaseUrl(), max: 1 });
  const db = drizzle(pool, { schema, casing: "snake_case" });
  const result = await seed(db);
  await pool.end();
  console.log(
    result.created
      ? `[seed] created account ${result.accountId} with monitor ${result.monitorId} and user ${SEED_USER_EMAIL}`
      : `[seed] already seeded (account ${result.accountId}); nothing to do`,
  );
}

// Run as a CLI only; importing this module (e.g. from verify) must not connect.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[seed] failed:", err);
    process.exit(1);
  });
}
