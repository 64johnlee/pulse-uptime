import { describe, it, expect, beforeEach } from "vitest";
import {
  checkAccountThrottle,
  clearAuthFailures,
  recordAuthFailure,
  sweepAccountThrottle,
} from "./account-throttle";

/**
 * F2 regression: repeated failures for ONE email must eventually trip the
 * throttle, and — because the store is keyed only by email — that holds no
 * matter how many different source IPs the attempts come from.
 */
describe("account throttle (F2)", () => {
  const email = "victim@example.com";
  const t0 = 1_000_000;

  beforeEach(() => {
    clearAuthFailures(email);
    clearAuthFailures("OTHER@example.com");
  });

  it("allows the first few failures, then blocks with backoff", () => {
    // The free-attempt budget passes cleanly.
    for (let i = 0; i < 5; i++) {
      expect(checkAccountThrottle(email, t0).ok).toBe(true);
      recordAuthFailure(email, t0);
    }
    // The next failure arms backoff.
    recordAuthFailure(email, t0);
    const blocked = checkAccountThrottle(email, t0);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("trips for one email regardless of source IP (email-keyed, IP-agnostic)", () => {
    // Simulate the same email attacked from many IPs: the throttle has no IP
    // input at all, so distributed attempts accumulate on the one account.
    for (let i = 0; i < 8; i++) recordAuthFailure(email, t0);
    expect(checkAccountThrottle(email, t0).ok).toBe(false);
    // A different account is unaffected.
    expect(checkAccountThrottle("bystander@example.com", t0).ok).toBe(true);
  });

  it("normalizes email case/whitespace so casing can't dodge the counter", () => {
    for (let i = 0; i < 8; i++) recordAuthFailure("Victim@Example.com ", t0);
    expect(checkAccountThrottle(email, t0).ok).toBe(false);
  });

  it("grows the backoff window exponentially", () => {
    for (let i = 0; i < 6; i++) recordAuthFailure(email, t0);
    const first = checkAccountThrottle(email, t0).retryAfterMs;
    recordAuthFailure(email, t0);
    const second = checkAccountThrottle(email, t0).retryAfterMs;
    expect(second).toBeGreaterThan(first);
  });

  it("clears on success", () => {
    for (let i = 0; i < 8; i++) recordAuthFailure(email, t0);
    expect(checkAccountThrottle(email, t0).ok).toBe(false);
    clearAuthFailures(email);
    expect(checkAccountThrottle(email, t0).ok).toBe(true);
  });

  it("decays after the reset window with no further failures", () => {
    for (let i = 0; i < 8; i++) recordAuthFailure(email, t0);
    expect(checkAccountThrottle(email, t0).ok).toBe(false);
    // Far in the future, the record is stale and the account is clean again.
    expect(checkAccountThrottle(email, t0 + 2 * 60 * 60 * 1000).ok).toBe(true);
  });

  it("sweep does not throw", () => {
    expect(() => sweepAccountThrottle(t0 + 10 * 60 * 60 * 1000)).not.toThrow();
  });
});
