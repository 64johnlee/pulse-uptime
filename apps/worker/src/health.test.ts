import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHealthServer, type HealthState } from "./health";

let server: ReturnType<typeof createHealthServer>;
let baseUrl: string;
let state: HealthState;
let clock: number;

const STALE_AFTER_MS = 60000;

beforeEach(async () => {
  clock = 1_000_000;
  state = { lastTickAt: null, lastError: null };
  server = createHealthServer({
    state,
    staleAfterMs: STALE_AFTER_MS,
    now: () => clock,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("health server", () => {
  it("liveness is always 200 alive", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "alive" });
  });

  it("readiness is 503 before the first tick", async () => {
    const res = await fetch(`${baseUrl}/readyz`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("not_ready");
  });

  it("readiness is 200 after a recent successful tick", async () => {
    state.lastTickAt = clock;
    const res = await fetch(`${baseUrl}/readyz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ready");
  });

  it("readiness is 503 when the last tick is stale", async () => {
    state.lastTickAt = clock - (STALE_AFTER_MS + 1);
    const res = await fetch(`${baseUrl}/readyz`);
    expect(res.status).toBe(503);
  });

  it("readiness is 503 when the last tick errored", async () => {
    state.lastTickAt = clock;
    state.lastError = "db unreachable";
    const res = await fetch(`${baseUrl}/readyz`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { lastError: string };
    expect(body.lastError).toBe("db unreachable");
  });

  it("unknown paths 404", async () => {
    const res = await fetch(`${baseUrl}/nope`);
    expect(res.status).toBe(404);
  });
});
