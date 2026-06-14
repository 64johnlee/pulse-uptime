import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { appMeta } from "./schema/app-meta";
import * as schema from "./schema/index";
import { SEED_MONITOR_NAME, seed } from "./seed";

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
  const db = drizzle(client, { schema, casing: "snake_case" });

  console.log(`[verify] applying migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });

  // Baseline smoke test: write and read back through the typed schema.
  await db
    .insert(appMeta)
    .values({ key: "schema_baseline", value: "0001" })
    .onConflictDoNothing();
  const meta = await db.select().from(appMeta);
  if (meta.length !== 1 || meta[0]?.value !== "0001") {
    throw new Error(`unexpected app_meta contents: ${JSON.stringify(meta)}`);
  }

  // Domain smoke test: run the dev seed and confirm it produced an account
  // with a monitor, exercising the accounts/users/monitors tables and FKs.
  const first = await seed(db);
  if (!first.created || !first.accountId || !first.monitorId) {
    throw new Error(`seed did not create expected rows: ${JSON.stringify(first)}`);
  }
  const monitors = await db
    .select()
    .from(schema.monitors)
    .where(eq(schema.monitors.accountId, first.accountId));
  if (monitors.length !== 1 || monitors[0]?.name !== SEED_MONITOR_NAME) {
    throw new Error(`unexpected monitors for seeded account: ${JSON.stringify(monitors)}`);
  }

  // Re-running the seed must be a no-op (idempotency).
  const second = await seed(db);
  if (second.created || second.accountId !== first.accountId) {
    throw new Error(`seed was not idempotent: ${JSON.stringify(second)}`);
  }

  await client.close();
  console.log(
    `[verify] OK — migrations applied, baseline round-trip succeeded, and seed produced account ${first.accountId} with monitor ${first.monitorId} (idempotent on re-run)`,
  );
}

main().catch((err) => {
  console.error("[verify] FAILED:", err);
  process.exit(1);
});
