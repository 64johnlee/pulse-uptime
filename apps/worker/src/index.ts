import "dotenv/config";
import { db } from "@pulse/db";
import { createHealthServer, type HealthState } from "./health";
import { runDueChecks } from "./runner";

/**
 * Pulse check-runner worker.
 *
 * A SEPARATE process from the Next.js web app (see docs/adr/0001-stack.md). On
 * each poll it claims every monitor whose `next_check_at` is due, probes the
 * target (HTTP/TCP/ping), appends a `checks` row, and opens/resolves incidents
 * on up↔down transitions. Scheduling and incident logic live in `runner.ts`;
 * this file is the loop, the health server, and lifecycle wiring.
 *
 * Deploy: runs as a long-running process under an orchestrator that restarts it
 * on crash (Docker `restart: unless-stopped` / a process manager). It exposes
 * liveness (`/healthz`) and readiness (`/readyz`) on WORKER_HEALTH_PORT. See
 * docs/adr/0003-worker-deploy.md.
 */
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 15000);
const HEALTH_PORT = Number(process.env.WORKER_HEALTH_PORT ?? 8080);
// A worker that hasn't completed a tick in this long is "not ready". Generous
// multiple of the poll interval so a single slow tick doesn't flap readiness.
const READY_STALE_MS = POLL_INTERVAL_MS * 4 + 30000;

let running = true;

async function main(): Promise<void> {
  console.log(
    `[worker] check-runner started (poll interval ${POLL_INTERVAL_MS}ms)`,
  );

  const health: HealthState = { lastTickAt: null, lastError: null };
  const healthServer = createHealthServer({
    state: health,
    staleAfterMs: READY_STALE_MS,
  });
  healthServer.listen(HEALTH_PORT, () =>
    console.log(`[worker] health server on :${HEALTH_PORT} (/healthz, /readyz)`),
  );

  const shutdown = (signal: string): void => {
    console.log(`[worker] received ${signal}, shutting down`);
    running = false;
    healthServer.close();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  while (running) {
    try {
      const summary = await runDueChecks({ db });
      health.lastTickAt = Date.now();
      health.lastError = null;
      if (summary.claimed > 0) {
        console.log(
          `[worker] tick — claimed ${summary.claimed}, recorded ${summary.recorded}` +
            `, incidents +${summary.incidentsOpened}/-${summary.incidentsResolved}` +
            (summary.skipped > 0 ? `, skipped ${summary.skipped}` : ""),
        );
      }
    } catch (err) {
      health.lastTickAt = Date.now();
      health.lastError = err instanceof Error ? err.message : "tick failed";
      console.error("[worker] tick failed:", err);
    }
    await sleep(POLL_INTERVAL_MS);
  }

  console.log("[worker] stopped");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
