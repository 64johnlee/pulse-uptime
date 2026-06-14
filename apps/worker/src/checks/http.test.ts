import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
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
  // These tests target a loopback server; unlock egress so the SSRF guard
  // (which blocks 127.0.0.1 by default) doesn't reject it. Mirrors the
  // self-hosted "monitor an internal host" configuration.
  process.env.PULSE_ALLOW_PRIVATE_TARGETS = "true";
  handler = (_req, res) => res.end("ok");
  server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  delete process.env.PULSE_ALLOW_PRIVATE_TARGETS;
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

  it("follows a redirect to a valid target", async () => {
    handler = (req, res) => {
      if (req.url === "/start") {
        res.statusCode = 302;
        res.setHeader("location", "/final");
        res.end();
        return;
      }
      res.statusCode = 200;
      res.end("arrived");
    };
    const result = await runHttpCheck(
      makeMonitor({ target: `${baseUrl}/start` }),
    );

    expect(result.status).toBe("up");
    expect(result.statusCode).toBe(200);
  });

  it("refuses a redirect chain that never terminates", async () => {
    handler = (_req, res) => {
      res.statusCode = 302;
      res.setHeader("location", "/loop");
      res.end();
    };
    const result = await runHttpCheck(
      makeMonitor({ target: `${baseUrl}/loop`, timeoutMs: 5000 }),
    );

    expect(result.status).toBe("down");
    expect(result.error).toContain("too many redirects");
  });
});

/**
 * SSRF regression (JJC-12): with egress locked (the production default), a
 * monitor pointed at an internal/metadata/private *literal* IP must refuse to
 * connect. These are the exact addresses called out in the issue — and the
 * case the connect-time DNS guard alone misses, because Node skips `lookup`
 * for IP literals.
 */
describe("runHttpCheck SSRF egress guard (locked)", () => {
  beforeEach(() => {
    delete process.env.PULSE_ALLOW_PRIVATE_TARGETS;
  });
  afterEach(() => {
    // Restore the unlocked default the loopback-server tests rely on.
    process.env.PULSE_ALLOW_PRIVATE_TARGETS = "true";
  });

  it("refuses the cloud metadata / link-local address", async () => {
    const result = await runHttpCheck(
      makeMonitor({ target: "http://169.254.169.254/latest/meta-data/" }),
    );

    expect(result.status).toBe("down");
    expect(result.statusCode).toBeNull();
    expect(result.error).toMatch(/^blocked:/);
  });

  it("refuses a loopback literal target", async () => {
    const result = await runHttpCheck(makeMonitor({ target: baseUrl }));

    expect(result.status).toBe("down");
    expect(result.statusCode).toBeNull();
    expect(result.error).toMatch(/^blocked:/);
  });

  it("refuses an RFC1918 (10.x) literal target", async () => {
    const result = await runHttpCheck(
      makeMonitor({ target: "http://10.0.0.1/" }),
    );

    expect(result.status).toBe("down");
    expect(result.statusCode).toBeNull();
    expect(result.error).toMatch(/^blocked:/);
  });
});
