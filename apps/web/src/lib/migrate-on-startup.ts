import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "@pulse/db";
import path from "path";

let migrationRun = false;

export async function runMigrationsIfNeeded() {
  // Only run once per process
  if (migrationRun) {
    return;
  }

  try {
    migrationRun = true;

    console.log("[init] Running database migrations...");

    // Migrations are stored in the db package
    const migrationsFolder = path.join(
      process.cwd(),
      "node_modules/@pulse/db/drizzle"
    );

    await migrate(db as any, {
      migrationsFolder,
    });

    console.log("[init] ✓ Migrations complete");
  } catch (error) {
    // Migrations might fail if already applied, that's okay
    console.warn("[init] Migration warning:", error);
  }
}
