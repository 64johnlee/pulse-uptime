import { describe, expect, it } from "vitest";
import { createMonitorSchema } from "./validation";

/**
 * Boundary validation tests. The schema is the contract both the UI and the
 * REST API rely on, so the edges (URL scheme, interval bounds, optional status)
 * are pinned here.
 */
describe("createMonitorSchema", () => {
  const base = { name: "API", target: "https://api.example.com/health" };

  it("accepts a minimal valid monitor and applies defaults", () => {
    const parsed = createMonitorSchema.parse(base);
    expect(parsed.method).toBe("GET");
    expect(parsed.intervalSeconds).toBe(60);
    expect(parsed.expectedStatusCode).toBeNull();
    expect(parsed.enabled).toBe(true);
  });

  it("coerces interval from a form string", () => {
    const parsed = createMonitorSchema.parse({ ...base, intervalSeconds: "300" });
    expect(parsed.intervalSeconds).toBe(300);
  });

  it("turns an empty expected status into null", () => {
    const parsed = createMonitorSchema.parse({ ...base, expectedStatusCode: "" });
    expect(parsed.expectedStatusCode).toBeNull();
  });

  it("keeps a provided expected status", () => {
    const parsed = createMonitorSchema.parse({ ...base, expectedStatusCode: "201" });
    expect(parsed.expectedStatusCode).toBe(201);
  });

  it("rejects a non-http scheme", () => {
    const result = createMonitorSchema.safeParse({
      ...base,
      target: "ftp://example.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-URL target", () => {
    const result = createMonitorSchema.safeParse({ ...base, target: "not a url" });
    expect(result.success).toBe(false);
  });

  it("rejects an interval below the floor", () => {
    const result = createMonitorSchema.safeParse({ ...base, intervalSeconds: 5 });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-range status code", () => {
    const result = createMonitorSchema.safeParse({
      ...base,
      expectedStatusCode: "999",
    });
    expect(result.success).toBe(false);
  });

  it("requires a name", () => {
    const result = createMonitorSchema.safeParse({ ...base, name: "  " });
    expect(result.success).toBe(false);
  });

  // F5: the REST API sends raw JSON, so a stringy "false" must NOT coerce to
  // true the way z.coerce.boolean() would.
  it('parses the string "false" as false (no truthiness footgun)', () => {
    const parsed = createMonitorSchema.parse({ ...base, enabled: "false" });
    expect(parsed.enabled).toBe(false);
  });

  it("parses other falsey strings as false", () => {
    for (const value of ["false", "0", "no", "", "  FALSE  "]) {
      expect(
        createMonitorSchema.parse({ ...base, enabled: value }).enabled,
      ).toBe(false);
    }
  });

  it("parses affirmative strings and real booleans as true", () => {
    for (const value of ["true", "1", "on", "yes", "TRUE"]) {
      expect(
        createMonitorSchema.parse({ ...base, enabled: value }).enabled,
      ).toBe(true);
    }
    expect(createMonitorSchema.parse({ ...base, enabled: true }).enabled).toBe(
      true,
    );
    expect(createMonitorSchema.parse({ ...base, enabled: false }).enabled).toBe(
      false,
    );
  });
});
