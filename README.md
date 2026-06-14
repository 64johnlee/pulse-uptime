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
| `pnpm lint`        | Lint all packages                                     |
| `pnpm test`        | Run unit tests (Vitest)                               |
| `pnpm db:generate` | Generate a new SQL migration from the Drizzle schema  |
| `pnpm db:migrate`  | Apply pending migrations to `DATABASE_URL`            |
| `pnpm db:verify`   | Apply migrations against in-process PGlite (no Docker)|

## Health check

`GET /api/health` returns `200 {status:"ok",db:"up"}` when the app can reach
Postgres, `503` otherwise.

## Continuous integration

Every push and pull request runs the `CI` workflow
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) on GitHub Actions:

`pnpm install` → `pnpm -r typecheck` → `pnpm -r lint` → `pnpm -r test` →
`pnpm -r build`

It runs on Node 20 / pnpm 9 and is **database-independent** — the `@pulse/db`
client connects lazily, so no Postgres is needed to verify a change. You can run
the exact same gate locally:

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## Deploy

The app deploys to **[Vercel](https://vercel.com)** — first-party Next.js host
with automatic preview URLs per push/PR. Rationale and alternatives are in
[docs/adr/0002-ci-and-deploy.md](docs/adr/0002-ci-and-deploy.md).

### Recommended: Vercel Git integration (no workflow to maintain)

1. Create a Vercel project and connect this Git repository.
2. Set **Root Directory** to `apps/web` (Vercel auto-detects the pnpm workspace
   and Next.js framework; `apps/web/vercel.json` pins the build/install
   commands).
3. Push a branch or open a PR → Vercel posts a **preview URL**; the default
   branch publishes to the **production URL**.

No environment variables are required to boot the placeholder app. Set
`DATABASE_URL` in the Vercel project once database-backed features land.

### Alternative: token-driven deploy from CI

If you prefer deploying from GitHub Actions instead of the Git integration,
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) does this. It is
**inert by default** and only runs when configured:

- Repo variable: `DEPLOY_ENABLED=true`
- Repo secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`

Pushes to the default branch deploy to production; other refs/PRs get a preview
URL.

> Note: Vercel Hobby is free but its ToS restricts commercial use — a company
> deployment needs Vercel **Pro (~$20/mo)**. That spend and the canonical GitHub
> org are pending CEO sign-off; CI is free regardless.
