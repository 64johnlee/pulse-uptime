"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import {
  createMonitor,
  deleteMonitor,
  updateMonitor,
} from "@/lib/monitors/service";
import { MonitorError } from "@/lib/monitors/errors";
import { createMonitorSchema } from "@/lib/monitors/validation";

// Coarse per-account anti-abuse limit for creates (per process; see
// rate-limit.ts caveats). Edits/deletes are bounded by the monitor cap.
const CREATE_LIMIT = 30;
const CREATE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Monitor server actions for the dashboard UI. Like the auth actions, these
 * are same-origin POSTs, so Next.js' built-in Origin check provides CSRF
 * protection without a manual token.
 *
 * Every action resolves the tenant from the session (`requireSession`) and
 * passes that account id to the service — the account is never taken from form
 * input, so a user can only ever act on their own monitors.
 */

const MONITORS_PATH = "/dashboard/monitors";

export interface MonitorFormState {
  error?: string;
  fieldErrors?: Partial<Record<keyof RawMonitorInput, string>>;
  values?: RawMonitorInput;
}

interface RawMonitorInput {
  name: string;
  target: string;
  method: string;
  intervalSeconds: string;
  expectedStatusCode: string;
  enabled: boolean;
}

/** Pull the monitor fields out of a submitted form as plain strings. */
function readForm(formData: FormData): RawMonitorInput {
  return {
    name: String(formData.get("name") ?? ""),
    target: String(formData.get("target") ?? ""),
    method: String(formData.get("method") ?? "GET"),
    intervalSeconds: String(formData.get("intervalSeconds") ?? ""),
    expectedStatusCode: String(formData.get("expectedStatusCode") ?? ""),
    // An unchecked checkbox is simply absent from the payload.
    enabled: formData.get("enabled") != null,
  };
}

/** Flatten a ZodError into a per-field message map for inline display. */
function fieldErrorsFrom(error: z.ZodError): MonitorFormState["fieldErrors"] {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in out)) out[key] = issue.message;
  }
  return out;
}

export async function createMonitorAction(
  _prev: MonitorFormState,
  formData: FormData,
): Promise<MonitorFormState> {
  const { account } = await requireSession();
  const raw = readForm(formData);

  if (
    !(await rateLimit(`monitor-create:${account.id}`, CREATE_LIMIT, CREATE_WINDOW_MS))
      .ok
  ) {
    return { error: "Too many monitors created just now. Try again shortly.", values: raw };
  }

  const parsed = createMonitorSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error), values: raw };
  }

  try {
    await createMonitor(account.id, parsed.data);
  } catch (err) {
    if (err instanceof MonitorError) return { error: err.message, values: raw };
    console.error("[monitors] create failed:", err);
    return { error: "Could not save the monitor. Please try again.", values: raw };
  }

  revalidatePath(MONITORS_PATH);
  redirect(MONITORS_PATH);
}

export async function updateMonitorAction(
  id: string,
  _prev: MonitorFormState,
  formData: FormData,
): Promise<MonitorFormState> {
  const { account } = await requireSession();
  const raw = readForm(formData);

  const parsed = createMonitorSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error), values: raw };
  }

  let updated;
  try {
    updated = await updateMonitor(account.id, id, parsed.data);
  } catch (err) {
    console.error("[monitors] update failed:", err);
    return { error: "Could not save the monitor. Please try again.", values: raw };
  }

  if (!updated) {
    return { error: "That monitor no longer exists.", values: raw };
  }

  revalidatePath(MONITORS_PATH);
  redirect(MONITORS_PATH);
}

/**
 * Delete a monitor. Plain action (no form state) bound to a small form button
 * in the list. Silently ignores an already-gone monitor — the end state (no
 * such monitor) is what the user asked for.
 */
export async function deleteMonitorAction(formData: FormData): Promise<void> {
  const { account } = await requireSession();
  const id = String(formData.get("id") ?? "");
  if (id) await deleteMonitor(account.id, id);
  revalidatePath(MONITORS_PATH);
  redirect(MONITORS_PATH);
}
