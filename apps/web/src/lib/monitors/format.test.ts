import { describe, expect, it } from "vitest";
import { formatInterval, statusLabel } from "./format";

describe("formatInterval", () => {
  it("renders sub-minute intervals in seconds", () => {
    expect(formatInterval(30)).toBe("every 30s");
  });

  it("renders minute intervals", () => {
    expect(formatInterval(60)).toBe("every 1 min");
    expect(formatInterval(300)).toBe("every 5 min");
  });

  it("renders hour intervals", () => {
    expect(formatInterval(3600)).toBe("every hour");
    expect(formatInterval(7200)).toBe("every 2 hr");
  });
});

describe("statusLabel", () => {
  it("maps known statuses", () => {
    expect(statusLabel("up")).toBe("Up");
    expect(statusLabel("down")).toBe("Down");
    expect(statusLabel("paused")).toBe("Paused");
    expect(statusLabel("unknown")).toBe("Pending");
  });
});
