# Pulse check-runner worker — long-running process, separate from the web app
# (see docs/adr/0001-stack.md and 0004-worker-deploy.md).
#
# Build from the REPO ROOT so the pnpm workspace + lockfile are in context:
#   docker build -f apps/worker/Dockerfile -t pulse-worker .
#
# The worker runs TypeScript directly via tsx (the @pulse/db package is consumed
# as source per ADR 0001), so there is no compile step — we install the
# workspace and run.
FROM node:22-alpine AS base
# iputils gives us a full-featured `ping` (busybox ping lacks the flags the
# ping checker relies on). The kernel must also allow unprivileged ICMP — grant
# the worker NET_RAW (see docker-compose.yml) rather than running as root.
RUN apk add --no-cache iputils \
  && corepack enable \
  && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# --- deps: install with the lockfile, cached until a manifest changes ---------
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/db/package.json packages/db/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
# Install only the worker and its workspace deps (@pulse/db); the full lockfile
# is honored for reproducibility.
RUN pnpm install --frozen-lockfile --filter @pulse/worker...

# --- runtime ------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app

# node_modules from the deps stage + the source the worker actually runs.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY tsconfig.base.json package.json pnpm-workspace.yaml ./
COPY packages/db ./packages/db
COPY apps/worker ./apps/worker

# Run as the unprivileged `node` user shipped in the base image.
USER node

# Liveness/readiness server (see src/health.ts). Keep in sync with
# WORKER_HEALTH_PORT.
EXPOSE 8080

CMD ["pnpm", "--filter", "@pulse/worker", "start"]
