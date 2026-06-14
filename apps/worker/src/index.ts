import "dotenv/config";

/**
 * Pulse check-runner worker (skeleton).
 *
 * This is a SEPARATE process from the Next.js web app (see
 * docs/adr/0001-stack.md). Its job is to poll due monitors, execute checks
 * (HTTP/TCP/ping), record results, and open/resolve incidents. For now it runs
 * a no-op tick loop so the process boots and the deploy path exists; the real
 * scheduling and check logic land with the data model (JJC-4) and monitor
 * features.
 */
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 15000);

let running = true;

async function tick(): Promise<void> {
  // TODO(JJC-4+): claim due monitors, run checks, persist results & incidents.
  console.log(`[worker] tick @ ${new Date().toISOString()} — no monitors yet`);
}

async function main(): Promise<void> {
  console.log(
    `[worker] check-runner started (poll interval ${POLL_INTERVAL_MS}ms)`,
  );

  const shutdown = (signal: string) => {
    console.log(`[worker] received ${signal}, shutting down`);
    running = false;
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  while (running) {
    try {
      await tick();
    } catch (err) {
      console.error("[worker] tick failed:", err);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  console.log("[worker] stopped");
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
