import { afterEach, describe, expect, it } from "vitest";
import { makeMonitor } from "../test-support";
import { runPingCheck } from "./ping";

afterEach(() => {
  delete process.env.PULSE_ALLOW_PRIVATE_TARGETS;
});

describe("runPingCheck", () => {
  it("reports up when the host answers ICMP echo", async () => {
    // Loopback always answers; unlock egress so the guard allows 127.0.0.1.
    process.env.PULSE_ALLOW_PRIVATE_TARGETS = "true";
    const result = await runPingCheck(
      makeMonitor({ type: "ping", target: "127.0.0.1", timeoutMs: 3000 }),
    );

    expect(result.status).toBe("up");
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeNull();
  });

  it("blocks an internal target when egress is locked (SSRF guard)", async () => {
    const result = await runPingCheck(
      makeMonitor({ type: "ping", target: "169.254.169.254" }),
    );

    expect(result.status).toBe("down");
    expect(result.error).toMatch(/^blocked:/);
  });

  it("reports down for an unresolvable host", async () => {
    const result = await runPingCheck(
      makeMonitor({
        type: "ping",
        target: "no-such-host.invalid",
        timeoutMs: 3000,
      }),
    );

    expect(result.status).toBe("down");
    expect(result.error).toBeTruthy();
  });
});
