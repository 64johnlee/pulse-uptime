import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { getDatabaseUrl } from "./env";
import * as schema from "./schema/index";

/**
 * Typed Postgres client backed by a shared connection pool.
 *
 * The pool and db handle are created LAZILY on first access and memoized on
 * `globalThis` — so merely importing `@pulse/db` never opens a connection or
 * requires DATABASE_URL (important for build-time imports and code paths that
 * don't touch the database). A missing/invalid DATABASE_URL surfaces at first
 * query, where callers can handle it (e.g. the /api/health route returns 503).
 *
 * Memoizing on `globalThis` also prevents Next.js dev/HMR and the worker from
 * leaking a new pool on every module reload.
 */
type PulseDb = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
  __pulsePool?: pg.Pool;
  __pulseDb?: PulseDb;
};

function getPool(): pg.Pool {
  if (!globalForDb.__pulsePool) {
    globalForDb.__pulsePool = new pg.Pool({
      connectionString: getDatabaseUrl(),
      max: 10,
    });
  }
  return globalForDb.__pulsePool;
}

function getDb(): PulseDb {
  if (!globalForDb.__pulseDb) {
    globalForDb.__pulseDb = drizzle(getPool(), { schema, casing: "snake_case" });
  }
  return globalForDb.__pulseDb;
}

/**
 * Lazy proxies. `db.select(...)` / `pool.query(...)` work exactly as before,
 * but the underlying pool is only constructed when a property is first touched.
 */
export const pool: pg.Pool = new Proxy({} as pg.Pool, {
  get(_t, prop, receiver) {
    return Reflect.get(getPool(), prop, receiver);
  },
});

export const db: PulseDb = new Proxy({} as PulseDb, {
  get(_t, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});

export { schema };
export type { PulseDb };
