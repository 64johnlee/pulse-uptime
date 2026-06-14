import { describe, expect, it } from "vitest";

import { buildHealth } from "./health";

describe("buildHealth", () => {
  it("reports ok with a 200 when the database is reachable", () => {
    expect(buildHealth(true)).toEqual({
      body: { status: "ok", db: "up" },
      httpStatus: 200,
    });
  });

  it("reports degraded with a 503 when the database is unreachable", () => {
    expect(buildHealth(false)).toEqual({
      body: { status: "degraded", db: "down" },
      httpStatus: 503,
    });
  });
});
