import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./client";

/**
 * SQL migration files shipped with this package (../drizzle relative to src).
 */
const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../drizzle",
);

/**
 * Apply all pending SQL migrations against the shared `@pulse/db` client.
 *
 * Reusable from runtime code (e.g. the web admin migrate endpoint). The CLI
 * equivalent lives in `migrate.ts`. Both target the node-postgres driver, which
 * is the driver the `db` client is built on.
 */
export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder });
}
