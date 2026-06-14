import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { appMeta } from "./schema/app-meta";

/**
 * No-Docker verification of the migration pipeline.
 *
 * PGlite is a real Postgres build compiled to WASM that runs in-process, so this
 * applies the exact same SQL migrations the production `pnpm db:migrate` does
 * — proving the DDL is valid Postgres and the baseline schema works — without
 * needing a running Postgres server. Used in CI and on machines without Docker.
 */
const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../drizzle",
);

async function main() {
  const client = new PGlite(); // ephemeral in-memory instance
  const db = drizzle(client, { casing: "snake_case" });

  console.log(`[verify] applying migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });

  // Smoke test: write and read back through the typed schema.
  await db
    .insert(appMeta)
    .values({ key: "schema_baseline", value: "0001" })
    .onConflictDoNothing();
  const rows = await db.select().from(appMeta);

  if (rows.length !== 1 || rows[0]?.value !== "0001") {
    throw new Error(`unexpected app_meta contents: ${JSON.stringify(rows)}`);
  }

  await client.close();
  console.log(
    `[verify] OK — migrations applied and round-trip succeeded (${rows.length} row in app_meta)`,
  );
}

main().catch((err) => {
  console.error("[verify] FAILED:", err);
  process.exit(1);
});
