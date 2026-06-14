/**
 * Validate and expose the database environment. Fail fast at startup with a
 * clear message rather than surfacing a cryptic connection error later.
 */
export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url || url.trim() === "") {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env (and `docker compose up -d db` for local Postgres).",
    );
  }
  return url;
}
