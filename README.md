# Pulse

Developer-first uptime monitoring and beautiful public status pages.

Fast, clean, affordable monitoring for small dev teams — with a generous free
tier. This repo is the v1 foundation.

## Stack

TypeScript end-to-end · Next.js 15 (App Router) · Postgres + Drizzle ORM ·
separate check-runner worker. See [docs/adr/0001-stack.md](docs/adr/0001-stack.md)
for the rationale and the web/worker split.

## Layout (pnpm monorepo)

| Path           | What                                                      |
| -------------- | -------------------------------------------------------- |
| `apps/web`     | Next.js web app, API routes, status pages                |
| `apps/worker`  | Check-runner worker (separate long-running process)      |
| `packages/db`  | Shared typed DB layer: Drizzle schema, client, migrations |
| `docs/adr`     | Architecture decision records                            |

## Prerequisites

- Node ≥ 20 (developed on 22)
- pnpm 9
- Docker (for local Postgres) — optional; see "Without Docker" below

## Getting started

```bash
pnpm install
cp .env.example .env

# Start Postgres and apply migrations
docker compose up -d db
pnpm db:migrate

# Run the web app (http://localhost:3000) and the worker
pnpm dev
pnpm dev:worker
```

### Without Docker

You can verify the database/migration pipeline without a Postgres server. This
applies the real migration SQL against an in-process PGlite (Postgres in WASM):

```bash
pnpm db:verify
```

## Common scripts

| Command            | Description                                            |
| ------------------ | ----------------------------------------------------- |
| `pnpm dev`         | Start the Next.js web app                             |
| `pnpm dev:worker`  | Start the check-runner worker                         |
| `pnpm build`       | Build all packages                                    |
| `pnpm typecheck`   | Type-check all packages                               |
| `pnpm db:generate` | Generate a new SQL migration from the Drizzle schema  |
| `pnpm db:migrate`  | Apply pending migrations to `DATABASE_URL`            |
| `pnpm db:verify`   | Apply migrations against in-process PGlite (no Docker)|

## Health check

`GET /api/health` returns `200 {status:"ok",db:"up"}` when the app can reach
Postgres, `503` otherwise.
