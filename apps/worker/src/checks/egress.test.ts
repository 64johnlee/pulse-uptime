import { afterEach, describe, expect, it } from "vitest";
import {
  EgressBlockedError,
  assertPublicHost,
  blockReason,
  egressBlockReason,
  guardedLookup,
  isEgressLocked,
} from "./egress";

afterEach(() => {
  delete process.env.PULSE_ALLOW_PRIVATE_TARGETS;
});

describe("blockReason", () => {
  it("allows public unicast addresses", () => {
    expect(blockReason("8.8.8.8")).toBeNull();
    expect(blockReason("1.1.1.1")).toBeNull();
    expect(blockReason("2606:4700:4700::1111")).toBeNull();
  });

  it("blocks the cloud metadata / link-local address", () => {
    expect(blockReason("169.254.169.254")).toMatch(/linkLocal/);
  });

  it("blocks RFC1918 private ranges", () => {
    expect(blockReason("10.0.0.1")).toMatch(/private/);
    expect(blockReason("192.168.1.1")).toMatch(/private/);
    expect(blockReason("172.16.0.1")).toMatch(/private/);
  });

  it("blocks loopback (v4 and v6)", () => {
    expect(blockReason("127.0.0.1")).toMatch(/loopback/);
    expect(blockReason("::1")).toMatch(/loopback/);
  });

  it("blocks unique-local IPv6", () => {
    expect(blockReason("fd00::1")).toMatch(/uniqueLocal/);
  });

  it("unwraps IPv4-mapped IPv6 so a private v4 can't be smuggled in", () => {
    expect(blockReason("::ffff:10.0.0.1")).toMatch(/private/);
    expect(blockReason("::ffff:8.8.8.8")).toBeNull();
  });

  it("rejects unparseable input", () => {
    expect(blockReason("not-an-ip")).toMatch(/unparseable/);
  });
});

describe("isEgressLocked", () => {
  it("is locked by default", () => {
    expect(isEgressLocked()).toBe(true);
  });

  it("unlocks when PULSE_ALLOW_PRIVATE_TARGETS=true", () => {
    process.env.PULSE_ALLOW_PRIVATE_TARGETS = "true";
    expect(isEgressLocked()).toBe(false);
  });
});

describe("assertPublicHost", () => {
  it("returns the IP for a public literal", async () => {
    await expect(assertPublicHost("8.8.8.8")).resolves.toEqual(["8.8.8.8"]);
  });

  it("rejects an internal IP literal when locked", async () => {
    await expect(assertPublicHost("169.254.169.254")).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
    await expect(assertPublicHost("127.0.0.1")).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
  });

  it("rejects hostnames that resolve to loopback (e.g. localhost)", async () => {
    await expect(assertPublicHost("localhost")).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
  });

  it("allows an internal literal when unlocked", async () => {
    process.env.PULSE_ALLOW_PRIVATE_TARGETS = "true";
    await expect(assertPublicHost("127.0.0.1")).resolves.toEqual(["127.0.0.1"]);
  });
});

describe("guardedLookup", () => {
  it("errors when a host resolves to a blocked address", async () => {
    const err = await new Promise<unknown>((resolve) =>
      guardedLookup("localhost", {}, (e: unknown) => resolve(e)),
    );
    expect(err).toBeInstanceOf(EgressBlockedError);
  });

  it("returns an address for a public literal", async () => {
    const address = await new Promise<string>((resolve, reject) =>
      guardedLookup("8.8.8.8", {}, (e: unknown, addr: unknown) =>
        e ? reject(e as Error) : resolve(addr as string),
      ),
    );
    expect(address).toBe("8.8.8.8");
  });
});

describe("egressBlockReason", () => {
  it("finds an EgressBlockedError nested in a cause chain", () => {
    const wrapped = new Error("fetch failed", {
      cause: new EgressBlockedError("private address (10.0.0.1)"),
    });
    expect(egressBlockReason(wrapped)).toMatch(/private address/);
  });

  it("returns null for an unrelated error", () => {
    expect(egressBlockReason(new Error("ECONNREFUSED"))).toBeNull();
  });
});
