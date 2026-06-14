# ADR 0004 — Worker deploy, ICMP ping, and SSRF egress controls

- **Status:** Accepted (deploy host pending CEO sign-off — see Cost / escalation)
- **Date:** 2026-06-15
- **Author:** Ferris (Founding Engineer)
- **Issue:** JJC-9 (follow-ups deferred from JJC-7)

## Context

The check-runner worker (`apps/worker`) is a separate long-running process from
the web app (ADR 0001). JJC-7 shipped HTTP + TCP checks, scheduling, and
incident transitions but deferred three hardening items to this ADR:

1. **ping (ICMP) monitors** — skipped by the runner because raw ICMP sockets
   need elevated privileges.
2. **SSRF / egress hardening** — the worker fetches user-supplied targets, so a
   tenant could point a monitor at internal/link-local/metadata addresses.
3. **Deploy/process wiring** — the worker was not stood up as a managed
   long-running process with health/liveness and restart-on-crash.

## Decision

### 1. ICMP ping via the OS `ping` binary (no raw sockets)

`apps/worker/src/checks/ping.ts` shells out to the system `ping` (one echo)
rather than opening raw ICMP sockets. Rationale:

- Raw ICMP needs `CAP_NET_RAW`/root. The OS `ping` is setuid or uses the
  kernel's unprivileged ICMP socket (`net.ipv4.ping_group_range`), so the
  worker process never holds elevated privileges.
- We invoke the **resolved IP literal** via `execFile` with an argument vector
  (never a shell), so there is no command-injection surface even though the
  target is user-supplied.
- The container installs full `iputils` (busybox `ping` lacks the flags) and is
  granted **only `NET_RAW`** (`cap_add: [NET_RAW]` in compose), not `privileged`.

The runner's skip path is removed: `ping` is now in `SUPPORTED_TYPES` and
dispatched like `http`/`tcp`.

### 2. SSRF egress guard (SECURITY — flagged for review)

`apps/worker/src/checks/egress.ts` is a shared guard used by all three checkers:

- Resolves the target host and **rejects any non-public address** — loopback,
  RFC1918 private, link-local (incl. the `169.254.169.254` cloud metadata
  endpoint), unique-local IPv6, CGNAT, multicast, broadcast, reserved. Only
  routable `unicast` is allowed. IPv4-mapped IPv6 is unwrapped first so a
  private v4 can't be smuggled through an IPv6 literal.
- **HTTP**: uses an undici `Agent` whose `connect.lookup` runs the guard at
  *connect time*, defeating DNS rebinding; redirects are followed **manually**
  (`redirect: "manual"`) so every hop — including a `Location:` pointing at a
  literal internal IP — is re-validated before we connect.
- **TCP / ping**: resolve + validate, then connect/ping the **pinned validated
  IP** (no TOCTOU between resolve and use).
- Default is **locked**. Self-hosters monitoring an internal network can opt in
  with `PULSE_ALLOW_PRIVATE_TARGETS=true`.

**Flagged for security review before public launch** (the issue references an
AGENTS.md security policy, which does not yet exist in-repo). Residual items for
the reviewer: the web layer should also validate/normalize targets on monitor
create so a clearly-internal target is rejected at input time, not only at probe
time; and confirm the allow-list escape hatch is acceptable for multi-tenant.

### 3. Deploy as a managed process

- **Containerized** via `apps/worker/Dockerfile` (multi-stage, runs as the
  unprivileged `node` user, `tsx` runs the TS directly per ADR 0001 — no compile
  step). A `.dockerignore` keeps the build context lean and prevents `.env`
  leakage.
- **Long-running + restart-on-crash** via the compose `worker` service with
  `restart: unless-stopped` and `depends_on: db (service_healthy)`.
- **Health/liveness**: `apps/worker/src/health.ts` serves `GET /healthz`
  (liveness — process up) and `GET /readyz` (readiness — a tick completed
  recently and didn't error) on `WORKER_HEALTH_PORT` (default 8080). The compose
  healthcheck polls `/readyz` so the orchestrator can distinguish a
  wedged-but-alive worker (e.g. stuck on the DB) from a healthy one.

## Alternatives considered

- **Privileged ICMP helper / raw sockets** — rejected: needs elevated
  privileges; the OS `ping` gets us real ICMP RTT without them.
- **TCP-only "ping" fallback** — rejected: semantically different from ICMP and
  misleading; the OS `ping` gives a faithful echo result.
- **Pre-flight DNS validation only (no connect-time guard)** — rejected as the
  sole control: leaves a DNS-rebinding TOCTOU window. The undici connect-time
  lookup closes it; pre-flight remains as defense-in-depth and for literal IPs.

## Cost / escalation

The web app is on Vercel (ADR 0002). The worker is **always-on** and Vercel does
not host long-running processes, so it needs a separate always-on host
(Render/Fly.io/Railway or a small VM) — a recurring cost. Per the JJC-3
precedent of escalating recurring-cost hosting, **the specific worker host +
budget is deferred to the CEO**. The Dockerfile + compose service make the
worker portable to any of them; this ADR does not commit to one.

## Consequences

- All three monitor types (`http`/`tcp`/`ping`) are probed; the skip path is gone.
- Monitors cannot be used as an SSRF proxy by default; internal monitoring is an
  explicit opt-in.
- The worker runs as a managed, self-healing process locally (compose) and is
  ready to drop onto an always-on host once the CEO confirms it.
- **Not build-verified in CI yet**: the Docker image could not be built in the
  authoring environment (no Docker daemon). Building `pulse-worker` in CI/host
  is a pre-launch TODO.
