import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getDatabaseUrl } from "./env";

/**
 * Apply all pending SQL migrations from ./drizzle against DATABASE_URL.
 *
 * Run against a real Postgres instance (docker-compose service `db`, CI, or
 * production). For a no-Docker smoke check of the migration pipeline, use
 * `pnpm db:verify`, which runs the same SQL against an in-process PGlite.
 */
const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../drizzle",
);

async function main() {
  const pool = new pg.Pool({ connectionString: getDatabaseUrl(), max: 1 });
  const db = drizzle(pool);
  console.log(`[migrate] applying migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  await pool.end();
  console.log("[migrate] done");
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
