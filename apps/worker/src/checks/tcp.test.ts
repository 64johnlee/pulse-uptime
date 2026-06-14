import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeMonitor } from "../test-support";
import { runTcpCheck } from "./tcp";

let server: net.Server;
let port: number;

beforeAll(async () => {
  // Loopback target — unlock egress so the SSRF guard doesn't block 127.0.0.1.
  process.env.PULSE_ALLOW_PRIVATE_TARGETS = "true";
  server = net.createServer((socket) => socket.end());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  delete process.env.PULSE_ALLOW_PRIVATE_TARGETS;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("runTcpCheck", () => {
  it("reports up when the port accepts a connection", async () => {
    const result = await runTcpCheck(
      makeMonitor({ type: "tcp", target: `127.0.0.1:${port}` }),
    );

    expect(result.status).toBe("up");
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeNull();
  });

  it("reports down when the connection is refused", async () => {
    const result = await runTcpCheck(
      makeMonitor({ type: "tcp", target: "127.0.0.1:1", timeoutMs: 2000 }),
    );

    expect(result.status).toBe("down");
    expect(result.error).toBeTruthy();
  });

  it("reports down on a malformed target", async () => {
    const result = await runTcpCheck(
      makeMonitor({ type: "tcp", target: "not-a-host-port" }),
    );

    expect(result.status).toBe("down");
    expect(result.error).toContain("invalid tcp target");
  });
});
