import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as schema from "./schema/index";
import type { PulseDb } from "./client";

/**
 * Test-only helper: spin up an ephemeral, fully-migrated database in-process.
 *
 * PGlite is real Postgres compiled to WASM, so this runs the exact SQL
 * migrations production does — no Docker, no shared state between tests. The
 * returned handle is typed as the production `PulseDb` (the node-postgres and
 * pglite query builders are API-compatible) so service/repository code can be
 * exercised unchanged.
 *
 * Imported only from tests via the `@pulse/db/testing` entry, which keeps the
 * PGlite dependency out of production bundles.
 */
const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../drizzle",
);

export interface TestDb {
  db: PulseDb;
  close: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const db = drizzle(client, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder });
  return {
    db: db as unknown as PulseDb,
    close: () => client.close(),
  };
}
