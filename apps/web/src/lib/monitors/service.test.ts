import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authRepo, type PulseDb } from "@pulse/db";
import { createTestDb, type TestDb } from "@pulse/db/testing";
import { createMonitorSchema } from "./validation";
import {
  createMonitor,
  deleteMonitor,
  getMonitor,
  listMonitors,
  updateMonitor,
} from "./service";

/**
 * Monitor CRUD against a real (PGlite) Postgres, proving the JJC-6 success
 * condition — a monitor can be created, listed, edited, and deleted, it
 * persists, and one account can never see or touch another account's monitors.
 */
let handle: TestDb;
let db: PulseDb;
let accountA: string;
let accountB: string;

beforeEach(async () => {
  handle = await createTestDb();
  db = handle.db;
  const a = await authRepo.createAccountWithUser(
    { teamName: "Acme", email: "a@acme.com", passwordHash: "x" },
    db,
  );
  const b = await authRepo.createAccountWithUser(
    { teamName: "Globex", email: "b@globex.com", passwordHash: "x" },
    db,
  );
  if (!a.ok || !b.ok) throw new Error("fixture setup failed");
  accountA = a.account.id;
  accountB = b.account.id;
});

afterEach(async () => {
  await handle.close();
});

const fields = (overrides = {}) =>
  createMonitorSchema.parse({
    name: "API health",
    target: "https://api.example.com/health",
    ...overrides,
  });

describe("createMonitor + listMonitors", () => {
  it("creates a monitor and lists it under its account", async () => {
    const created = await createMonitor(accountA, fields(), db);
    expect(created.accountId).toBe(accountA);
    expect(created.type).toBe("http");
    expect(created.status).toBe("unknown");

    const list = await listMonitors(accountA, db);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(created.id);
  });

  it("persists provided fields", async () => {
    const created = await createMonitor(
      accountA,
      fields({ method: "HEAD", intervalSeconds: 300, expectedStatusCode: "201" }),
      db,
    );
    expect(created.method).toBe("HEAD");
    expect(created.intervalSeconds).toBe(300);
    expect(created.expectedStatusCode).toBe(201);
  });
});

describe("account scoping", () => {
  it("does not leak monitors across accounts", async () => {
    await createMonitor(accountA, fields({ name: "A1" }), db);
    expect(await listMonitors(accountB, db)).toHaveLength(0);
  });

  it("cannot read another account's monitor by id", async () => {
    const created = await createMonitor(accountA, fields(), db);
    expect(await getMonitor(accountB, created.id, db)).toBeUndefined();
  });

  it("cannot update another account's monitor", async () => {
    const created = await createMonitor(accountA, fields(), db);
    const result = await updateMonitor(
      accountB,
      created.id,
      fields({ name: "hijacked" }),
      db,
    );
    expect(result).toBeUndefined();
    const original = await getMonitor(accountA, created.id, db);
    expect(original?.name).toBe("API health");
  });

  it("cannot delete another account's monitor", async () => {
    const created = await createMonitor(accountA, fields(), db);
    expect(await deleteMonitor(accountB, created.id, db)).toBe(false);
    expect(await getMonitor(accountA, created.id, db)).toBeDefined();
  });
});

describe("updateMonitor + deleteMonitor", () => {
  it("edits fields in place and persists them", async () => {
    const created = await createMonitor(accountA, fields(), db);
    const updated = await updateMonitor(
      accountA,
      created.id,
      fields({ name: "Renamed", intervalSeconds: 900, enabled: false }),
      db,
    );
    expect(updated?.name).toBe("Renamed");
    expect(updated?.intervalSeconds).toBe(900);
    expect(updated?.enabled).toBe(false);

    const reread = await getMonitor(accountA, created.id, db);
    expect(reread?.name).toBe("Renamed");
  });

  it("deletes a monitor", async () => {
    const created = await createMonitor(accountA, fields(), db);
    expect(await deleteMonitor(accountA, created.id, db)).toBe(true);
    expect(await listMonitors(accountA, db)).toHaveLength(0);
  });
});
