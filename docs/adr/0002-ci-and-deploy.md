# ADR 0002 — CI pipeline and deploy host

- **Status:** Accepted
- **Date:** 2026-06-14
- **Author:** Ferris (Founding Engineer)
- **Issue:** JJC-3

## Context

The foundation must be shippable and verifiable on every change: automated
checks on push/PR, and a deploy path that yields a live preview URL for the
Next.js app. This builds directly on the [ADR 0001](0001-stack.md) stack
(TypeScript, Next.js 15, pnpm monorepo, Postgres + Drizzle, separate worker).

## Decision

### CI — GitHub Actions

A single `CI` workflow (`.github/workflows/ci.yml`) runs on every `push` and
`pull_request`:

1. `pnpm install --frozen-lockfile` (Node 20, pnpm 9, pnpm store cached)
2. `pnpm -r typecheck` — `tsc --noEmit` across all packages
3. `pnpm -r lint` — `next lint` / package linters
4. `pnpm -r test` — Vitest
5. `pnpm -r build` — proves the app actually builds (deploy-readiness)

The pipeline is **database-independent**: the `@pulse/db` client connects
lazily (see `packages/db/src/client.ts`), so typecheck/lint/test/build need no
Postgres. DB migrations are verified separately via `pnpm db:verify` (in-process
PGlite) and belong to the data-model track, not the per-commit gate. Tests that
touch logic are written against pure helpers (e.g. `apps/web/src/lib/health.ts`)
so the suite is fast and deterministic.

### Deploy host — Vercel

**Chosen: Vercel.** Rationale:

- First-party Next.js host; zero-config App Router support.
- Automatic **preview URLs** for every push/PR — exactly the "live preview URL"
  this work needs — plus a stable production URL on the default branch.
- Generous free tier; trivial monorepo support (Root Directory = `apps/web`).

Two deploy mechanisms are supported; **the Git integration is recommended**:

- **Vercel Git integration (recommended):** connect the repo in the Vercel
  dashboard, set Root Directory to `apps/web`. Every push/PR then gets a preview
  URL automatically with no workflow to maintain.
- **CI workflow (optional):** `.github/workflows/deploy.yml` deploys via the
  Vercel CLI. It is **inert by default** — it only runs when the repo variable
  `DEPLOY_ENABLED=true` and the `VERCEL_TOKEN` / `VERCEL_ORG_ID` /
  `VERCEL_PROJECT_ID` secrets are set.

### Alternatives considered

- **GitHub Pages** — free and self-serviceable, but **static-export only**.
  Rejected: Pulse needs SSR, API routes (`/api/health`), auth, and Postgres.
- **Render / Fly.io / Railway** — viable always-on hosts, but more infra/config
  and also paid for always-on instances. Vercel is the simplest fit for Next.js.

## Cost / escalation

Vercel **Hobby** is free but its ToS restricts commercial use; a real company
app needs **Pro (~$20/mo)**. Per JJC-3's instruction to escalate recurring-cost
hosting, this was raised to the CEO (board approval `737546d5`) along with the
question of the canonical GitHub home (no company org exists yet). CI itself
costs nothing on a repo; only the always-on commercial host carries spend.

## Consequences

- Every push/PR is typechecked, linted, tested, and built before merge.
- A live preview URL is one connection away once the GitHub home + Vercel
  account are confirmed by the CEO; the workflow and config are already in place.
