import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeMonitor } from "../test-support";
import { runHttpCheck } from "./http";

/**
 * A controllable local HTTP target. Each test sets `handler` to decide how the
 * server responds, so we exercise the checker against real sockets without
 * touching the network.
 */
let server: http.Server;
let baseUrl: string;
let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

beforeAll(async () => {
  handler = (_req, res) => res.end("ok");
  server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("runHttpCheck", () => {
  it("reports up with latency for a 2xx response", async () => {
    handler = (_req, res) => {
      res.statusCode = 200;
      res.end("hello");
    };
    const result = await runHttpCheck(makeMonitor({ target: baseUrl }));

    expect(result.status).toBe("up");
    expect(result.statusCode).toBe(200);
    expect(result.error).toBeNull();
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("reports down with the status code on a 5xx response", async () => {
    handler = (_req, res) => {
      res.statusCode = 503;
      res.end("nope");
    };
    const result = await runHttpCheck(makeMonitor({ target: baseUrl }));

    expect(result.status).toBe("down");
    expect(result.statusCode).toBe(503);
    expect(result.error).toBe("HTTP 503");
  });

  it("honours expectedStatusCode (a non-2xx can be healthy)", async () => {
    handler = (_req, res) => {
      res.statusCode = 401;
      res.end("auth");
    };
    const result = await runHttpCheck(
      makeMonitor({ target: baseUrl, expectedStatusCode: 401 }),
    );

    expect(result.status).toBe("up");
    expect(result.statusCode).toBe(401);
  });

  it("reports down when the response misses expectedStatusCode", async () => {
    handler = (_req, res) => {
      res.statusCode = 200;
      res.end("ok");
    };
    const result = await runHttpCheck(
      makeMonitor({ target: baseUrl, expectedStatusCode: 204 }),
    );

    expect(result.status).toBe("down");
    expect(result.error).toBe("expected HTTP 204, got 200");
  });

  it("reports down on timeout", async () => {
    handler = (_req, res) => {
      // Never respond within the monitor's timeout.
      setTimeout(() => res.end("late"), 500);
    };
    const result = await runHttpCheck(
      makeMonitor({ target: baseUrl, timeoutMs: 80 }),
    );

    expect(result.status).toBe("down");
    expect(result.responseTimeMs).toBeNull();
    expect(result.error).toContain("timeout");
  });

  it("reports down when the target is unreachable", async () => {
    // Port 1 is reserved and refuses connections.
    const result = await runHttpCheck(
      makeMonitor({ target: "http://127.0.0.1:1", timeoutMs: 2000 }),
    );

    expect(result.status).toBe("down");
    expect(result.statusCode).toBeNull();
    expect(result.error).toBeTruthy();
  });
});
