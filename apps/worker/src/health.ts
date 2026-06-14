import http from "node:http";

/**
 * Mutable health state the runner updates after every tick. The health server
 * reads it to answer liveness/readiness probes. Kept as a plain object so the
 * loop can mutate one field per tick without allocating.
 */
export interface HealthState {
  /** Epoch ms of the last tick that completed (ok or not), or null pre-first. */
  lastTickAt: number | null;
  /** Error message from the most recent failed tick; null when last tick was ok. */
  lastError: string | null;
}

export interface HealthServerOptions {
  state: HealthState;
  /** A tick is considered fresh if it happened within this window. */
  staleAfterMs: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

/**
 * A tiny HTTP server exposing two probes for the deploy orchestrator:
 *
 *  - `GET /healthz` — liveness. 200 whenever the process is up and its event
 *    loop is responsive. A failure here means "restart me".
 *  - `GET /readyz`  — readiness. 200 only when a tick has run recently and the
 *    last one didn't error, so the orchestrator can tell a wedged-but-alive
 *    worker (e.g. stuck on the DB) from a healthy one.
 *
 * Restart-on-crash itself is the orchestrator's job (Docker `restart` policy /
 * process manager); this server gives it the signal to act on.
 */
export function createHealthServer(options: HealthServerOptions): http.Server {
  const now = options.now ?? Date.now;

  return http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];

    if (req.method !== "GET") {
      send(res, 405, { error: "method not allowed" });
      return;
    }

    if (path === "/healthz") {
      send(res, 200, { status: "alive" });
      return;
    }

    if (path === "/readyz") {
      const { lastTickAt, lastError } = options.state;
      const age = lastTickAt == null ? null : now() - lastTickAt;
      const ready =
        lastTickAt != null && age! <= options.staleAfterMs && lastError == null;
      send(res, ready ? 200 : 503, {
        status: ready ? "ready" : "not_ready",
        lastTickAgeMs: age,
        lastError,
      });
      return;
    }

    send(res, 404, { error: "not found" });
  });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}
