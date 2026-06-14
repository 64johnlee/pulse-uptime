import { z } from "zod";
import {
  HTTP_METHODS,
  MAX_INTERVAL_SECONDS,
  MAX_NAME_LENGTH,
  MAX_STATUS_CODE,
  MAX_TARGET_LENGTH,
  MIN_INTERVAL_SECONDS,
  MIN_STATUS_CODE,
} from "./config";

/**
 * Boundary validation for HTTP monitor input. Used by both the server actions
 * (UI) and the REST API so the two paths can never drift. Coercion handles the
 * fact that HTML form fields and JSON both arrive as strings/loose values.
 */

const name = z
  .string()
  .trim()
  .min(1, "Give the monitor a name.")
  .max(MAX_NAME_LENGTH, "That name is too long.");

/**
 * The probe target. Must be an absolute http(s) URL — we reject other schemes
 * (file:, javascript:, etc.) so a monitor can only ever drive an HTTP request.
 */
const target = z
  .string()
  .trim()
  .min(1, "Enter a URL to monitor.")
  .max(MAX_TARGET_LENGTH, "That URL is too long.")
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "Enter a valid http:// or https:// URL.");

const method = z.enum(HTTP_METHODS);

const intervalSeconds = z.coerce
  .number()
  .int("Use a whole number of seconds.")
  .min(MIN_INTERVAL_SECONDS, `Minimum interval is ${MIN_INTERVAL_SECONDS}s.`)
  .max(MAX_INTERVAL_SECONDS, "Maximum interval is one day.");

/**
 * Optional expected status. An empty/absent field becomes null, meaning "any
 * 2xx is healthy"; a provided value must be a real HTTP code. `preprocess`
 * normalizes the empty cases to null *before* the numeric schema runs, so the
 * range message only fires for genuinely out-of-range numbers.
 */
const expectedStatusCode = z.preprocess(
  (value) =>
    value === "" || value === undefined || value === null ? null : value,
  z.coerce
    .number()
    .int("Enter a whole status code.")
    .min(MIN_STATUS_CODE, "Enter a status code between 100 and 599, or leave blank.")
    .max(MAX_STATUS_CODE, "Enter a status code between 100 and 599, or leave blank.")
    .nullable(),
);

/**
 * Enabled flag. We deliberately avoid `z.coerce.boolean()`: it does plain JS
 * truthiness, so a JSON body of `{"enabled":"false"}` (a non-empty string)
 * coerces to `true` — the opposite of the caller's intent. Instead we parse
 * explicitly: real booleans pass through (the UI form already sends one), and
 * stringy values from the REST API are matched against an affirmative set, so
 * "false"/"0"/"no"/"" all resolve to `false`.
 */
const TRUTHY_STRINGS = new Set(["true", "1", "on", "yes"]);
const enabled = z.union([z.boolean(), z.string()]).transform((value) => {
  if (typeof value === "boolean") return value;
  return TRUTHY_STRINGS.has(value.trim().toLowerCase());
});

export const createMonitorSchema = z.object({
  name,
  target,
  method: method.default("GET"),
  intervalSeconds: intervalSeconds.default(60),
  expectedStatusCode,
  enabled: enabled.default(true),
});

/** Edit accepts the same shape; every field is required on submit so the form
 * round-trips the full row. Partial PATCH semantics live in the service. */
export const updateMonitorSchema = createMonitorSchema;

export type CreateMonitorFields = z.infer<typeof createMonitorSchema>;
export type UpdateMonitorFields = z.infer<typeof updateMonitorSchema>;
