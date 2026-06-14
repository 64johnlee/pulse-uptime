# ADR 0001 — v1 stack and web/worker split

- **Status:** Accepted
- **Date:** 2026-06-14
- **Author:** Ferris (Founding Engineer)
- **Issue:** JJC-2

## Context

Pulse is developer-first uptime monitoring with beautiful public status pages.
Our wedge is being fast, clean, and affordable for small dev teams. As employee
#1 on engineering, this ADR sets the technical foundation everything else builds
on. We optimize for **shipping a thin vertical slice fast** while staying on a
stack the team can grow into. Nothing here is a costly-infra or one-way-door
commitment — it is all local/OSS tooling, so no CEO sign-off was required to
proceed.

## Decision

### Language & runtime

- **TypeScript end-to-end.** One language for web, worker, and shared DB layer.
- **Node ≥ 20** (developed on 22). `tsx` runs TS directly for the worker and
  scripts without a separate build step in dev.

### Repository shape — pnpm monorepo

A single repo with pnpm workspaces:

```
apps/web      — Next.js (App Router) web app + API routes + status pages
apps/worker   — check-runner worker (separate long-running process)
packages/db   — shared typed DB layer: Drizzle schema, client, migrations
docs/adr      — architecture decision records
docker-compose.yml — local Postgres
```

Rationale: the web app and the check-runner must share the data model but run as
**different processes with different lifecycles**. A monorepo lets them depend
on one typed `@pulse/db` package (no schema drift, no copy-paste types) while
deploying independently. pnpm workspaces are lightweight and fast; we are not
adding Turborepo/Nx until build times justify it (YAGNI).

### Web app — Next.js 15, App Router, React 19

Next.js gives us SSR/SSG, API route handlers, and great DX in one framework —
ideal for both the marketing/app surface and fast-loading public status pages
(SSG/ISR later). App Router is the current default and where the ecosystem is
heading.

### Database — Postgres + Drizzle ORM

- **Postgres** is the obvious relational choice for accounts, monitors, checks,
  and incidents, with strong support for time-series-ish check history and
  later partitioning. Local dev runs it via `docker-compose`.
- **Drizzle ORM** for a typed query layer and **drizzle-kit** for migrations.
  Chosen over Prisma for v1 because it is lighter, SQL-first (migrations are
  plain reviewable `.sql`), has no separate engine binary, and runs naturally in
  both the Next.js runtime and the worker. Migrations live in
  `packages/db/drizzle` and are the single source of truth applied identically
  in dev, CI, and prod via `pnpm db:migrate`.

### The monitor/worker split (key architectural decision)

The **check-runner is a separate process from the web app** (`apps/worker`), not
a route or a serverless cron inside Next.js. Reasons:

1. **Different workload shape.** Checks are continuous, scheduled, outbound I/O
   (HTTP/TCP/ping) on a tight cadence. The web app is request/response. Mixing
   them couples scaling and risks long-running work inside request handlers or
   serverless timeouts.
2. **Independent scaling & deploy.** We can scale check throughput (more worker
   instances / sharded monitors) without touching the web tier, and deploy the
   web app on a serverless/edge platform while the worker runs on a persistent
   host.
3. **Isolation.** A misbehaving check (slow target, DNS hang) must never degrade
   the dashboard or status pages.

Both processes import the same `@pulse/db`. Coordination for v1 is via Postgres
(the worker claims due monitors with row-level locking, e.g.
`SELECT … FOR UPDATE SKIP LOCKED`); a dedicated queue/broker is deferred until
volume demands it.

## Local development & verification

- `docker compose up -d db` starts Postgres; `pnpm db:migrate` applies
  migrations; `pnpm dev` boots the web app; `pnpm dev:worker` boots the worker.
- **No-Docker verification:** `pnpm db:verify` applies the exact same SQL
  migrations against an in-process **PGlite** (real Postgres compiled to WASM)
  and round-trips a row. This lets CI and Docker-less machines prove the
  migration pipeline is valid Postgres without a running server. PGlite is a
  test/verify aid only — production always uses real Postgres.

## Security baseline

- Strict security headers + CSP set in `next.config.ts`.
- Secrets via environment only (`.env`, gitignored); `.env.example` documents
  the contract. `DATABASE_URL` is validated at startup (fail fast).

## Consequences

- **Positive:** one language and one shared typed schema; thin slice ships fast;
  web and worker scale/deploy independently; migrations are reviewable SQL;
  Docker-less contributors and CI can still verify the DB pipeline.
- **Trade-offs / revisit later:** Drizzle is younger than Prisma (acceptable;
  migration SQL is portable if we switch). Postgres-as-queue is simple but will
  need a real queue at higher check volume. Monorepo tooling stays minimal until
  build times justify more.

## Follow-ups

- **JJC-4** — real data model + migrations (accounts, monitors, checks,
  incidents), replacing the `app_meta` baseline table.
- **JJC-5** — auth (sign up / log in).
- CI pipeline (lint, typecheck, `db:verify`, build) and a deploy path.
