import http from "node:http";
import type { AddressInfo } from "node:net";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "@pulse/db/schema";
import { createTestDb, type TestDb } from "@pulse/db/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDueChecks } from "./runner";

/**
 * End-to-end runner tests against a real (in-process PGlite) database and a real
 * local HTTP target. This is the demonstration of JJC-7's success condition: a
 * seeded monitor records checks on schedule and an incident opens when the
 * target is unreachable, then resolves on recovery.
 */
describe("runDueChecks", () => {
  let testDb: TestDb;
  let server: http.Server;
  let baseUrl: string;
  let statusToReturn = 200;
  const T0 = new Date("2026-06-14T12:00:00.000Z");
  const INTERVAL = 60;

  beforeEach(async () => {
    // The probes target a loopback server; unlock egress so the SSRF guard
    // (which blocks 127.0.0.1 by default) doesn't reject them. Mirrors the
    // self-hosted "monitor an internal host" configuration.
    process.env.PULSE_ALLOW_PRIVATE_TARGETS = "true";
    testDb = await createTestDb();
    statusToReturn = 200;
    server = http.createServer((_req, res) => {
      res.statusCode = statusToReturn;
      res.end(String(statusToReturn));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    delete process.env.PULSE_ALLOW_PRIVATE_TARGETS;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await testDb.close();
  });

  async function seedMonitor(): Promise<string> {
    const [account] = await testDb.db
      .insert(schema.accounts)
      .values({ name: "Acme Inc" })
      .returning();
    const [monitor] = await testDb.db
      .insert(schema.monitors)
      .values({
        accountId: account!.id,
        name: "Acme Website",
        type: "http",
        target: baseUrl,
        intervalSeconds: INTERVAL,
        timeoutMs: 2000,
        nextCheckAt: T0,
      })
      .returning();
    return monitor!.id;
  }

  function at(secondsAfterT0: number): () => Date {
    return () => new Date(T0.getTime() + secondsAfterT0 * 1000);
  }

  async function getMonitor(id: string) {
    const [m] = await testDb.db
      .select()
      .from(schema.monitors)
      .where(eq(schema.monitors.id, id));
    return m!;
  }

  async function getChecks(id: string) {
    return testDb.db
      .select()
      .from(schema.checks)
      .where(eq(schema.checks.monitorId, id))
      .orderBy(desc(schema.checks.checkedAt));
  }

  async function getIncidents(id: string) {
    return testDb.db
      .select()
      .from(schema.incidents)
      .where(eq(schema.incidents.monitorId, id));
  }

  it("records a check and advances next_check_at when up", async () => {
    const id = await seedMonitor();

    const summary = await runDueChecks({ db: testDb.db, now: at(0) });

    expect(summary).toMatchObject({ claimed: 1, recorded: 1, incidentsOpened: 0 });
    const checks = await getChecks(id);
    expect(checks).toHaveLength(1);
    expect(checks[0]!.status).toBe("up");
    expect(checks[0]!.statusCode).toBe(200);

    const monitor = await getMonitor(id);
    expect(monitor.status).toBe("up");
    expect(monitor.lastCheckedAt).not.toBeNull();
    // Scheduled forward by exactly one interval.
    expect(monitor.nextCheckAt.getTime()).toBe(T0.getTime() + INTERVAL * 1000);
    expect(await getIncidents(id)).toHaveLength(0);
  });

  it("does not claim a monitor before it is due", async () => {
    await seedMonitor();
    await runDueChecks({ db: testDb.db, now: at(0) }); // bumps next_check_at to +60s

    // Run again still at T0: the monitor is no longer due.
    const summary = await runDueChecks({ db: testDb.db, now: at(0) });
    expect(summary.claimed).toBe(0);
  });

  it("opens an incident on up→down and resolves it on recovery", async () => {
    const id = await seedMonitor();

    // Tick 1 — healthy.
    await runDueChecks({ db: testDb.db, now: at(0) });

    // Tick 2 — target now returns 503: should open exactly one incident.
    statusToReturn = 503;
    const down = await runDueChecks({ db: testDb.db, now: at(INTERVAL) });
    expect(down).toMatchObject({ recorded: 1, incidentsOpened: 1, incidentsResolved: 0 });

    let incidents = await getIncidents(id);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]!.status).toBe("open");
    expect(incidents[0]!.cause).toBe("HTTP 503");
    expect((await getMonitor(id)).status).toBe("down");

    // Tick 3 — still down: must NOT open a duplicate incident.
    const stillDown = await runDueChecks({ db: testDb.db, now: at(INTERVAL * 2) });
    expect(stillDown.incidentsOpened).toBe(0);
    expect(await getIncidents(id)).toHaveLength(1);

    // Tick 4 — recovered: resolve the open incident.
    statusToReturn = 200;
    const recovered = await runDueChecks({ db: testDb.db, now: at(INTERVAL * 3) });
    expect(recovered).toMatchObject({ incidentsResolved: 1, incidentsOpened: 0 });

    incidents = await getIncidents(id);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]!.status).toBe("resolved");
    expect(incidents[0]!.resolvedAt).not.toBeNull();
    expect((await getMonitor(id)).status).toBe("up");
    expect(await getChecks(id)).toHaveLength(4);
  });

  it("opens an incident when the target is unreachable", async () => {
    const id = await seedMonitor();
    await runDueChecks({ db: testDb.db, now: at(0) }); // healthy baseline

    // Take the target down entirely.
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const summary = await runDueChecks({ db: testDb.db, now: at(INTERVAL) });
    expect(summary.incidentsOpened).toBe(1);

    const checks = await getChecks(id);
    expect(checks[0]!.status).toBe("down");
    expect(checks[0]!.statusCode).toBeNull();
    expect(checks[0]!.error).toBeTruthy();

    const incidents = await getIncidents(id);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]!.status).toBe("open");
  });

  it("probes ping monitors and records the result (no longer skipped)", async () => {
    // ping was the deferred type in JJC-7; JJC-9 implements it, so the runner
    // now probes it like any other. Inject the probe so the assertion doesn't
    // depend on the host's `ping` binary or network.
    const [account] = await testDb.db
      .insert(schema.accounts)
      .values({ name: "Acme Inc" })
      .returning();
    const [monitor] = await testDb.db
      .insert(schema.monitors)
      .values({
        accountId: account!.id,
        name: "Ping target",
        type: "ping",
        target: "1.1.1.1",
        nextCheckAt: T0,
      })
      .returning();

    const summary = await runDueChecks({
      db: testDb.db,
      now: at(0),
      probe: async () => ({
        status: "up",
        responseTimeMs: 7,
        statusCode: null,
        error: null,
      }),
    });

    expect(summary).toMatchObject({ claimed: 1, skipped: 0, recorded: 1 });
    const checks = await getChecks(monitor!.id);
    expect(checks).toHaveLength(1);
    expect(checks[0]!.status).toBe("up");
    // Rescheduled forward like any probed monitor.
    const updated = await testDb.db
      .select()
      .from(schema.monitors)
      .where(and(eq(schema.monitors.id, monitor!.id)));
    expect(updated[0]!.nextCheckAt.getTime()).toBeGreaterThan(T0.getTime());
  });
});
