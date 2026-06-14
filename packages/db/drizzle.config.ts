import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration.
 *
 * Migrations are generated from the typed schema in `src/schema` and written as
 * plain SQL to `./drizzle`. The same SQL is applied in every environment
 * (local Postgres, CI, production) so the migration history is the single
 * source of truth — see docs/adr/0001-stack.md.
 */
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://pulse:pulse@localhost:5432/pulse",
  },
  strict: true,
  verbose: true,
});
