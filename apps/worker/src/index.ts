import "dotenv/config";
import { db } from "@pulse/db";
import { runDueChecks } from "./runner";

/**
 * Pulse check-runner worker.
 *
 * A SEPARATE process from the Next.js web app (see docs/adr/0001-stack.md). On
 * each poll it claims every monitor whose `next_check_at` is due, probes the
 * target (HTTP/TCP), appends a `checks` row, and opens/resolves incidents on
 * up↔down transitions. Scheduling and incident logic live in `runner.ts`; this
 * file is just the loop and lifecycle wiring.
 */
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 15000);

let running = true;

async function main(): Promise<void> {
  console.log(
    `[worker] check-runner started (poll interval ${POLL_INTERVAL_MS}ms)`,
  );

  const shutdown = (signal: string): void => {
    console.log(`[worker] received ${signal}, shutting down`);
    running = false;
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  while (running) {
    try {
      const summary = await runDueChecks({ db });
      if (summary.claimed > 0) {
        console.log(
          `[worker] tick — claimed ${summary.claimed}, recorded ${summary.recorded}` +
            `, incidents +${summary.incidentsOpened}/-${summary.incidentsResolved}` +
            (summary.skipped > 0 ? `, skipped ${summary.skipped}` : ""),
        );
      }
    } catch (err) {
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
