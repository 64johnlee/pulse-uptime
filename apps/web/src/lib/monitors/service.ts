import { monitorsRepo, type Monitor, type PulseDb } from "@pulse/db";
import { MAX_MONITORS_PER_ACCOUNT } from "./config";
import { MonitorError } from "./errors";
import type { CreateMonitorFields, UpdateMonitorFields } from "./validation";

/**
 * Monitor service — the single orchestration surface the web app uses for
 * monitors. Both the UI server actions and the REST API go through here, so
 * the field → storage mapping (and the account-scoping contract) lives in one
 * place and the two entry points can never drift.
 *
 * Account scoping is non-negotiable: every function takes an `accountId` and
 * forwards it to the repository, which constrains every query to that tenant.
 * Callers derive `accountId` from the session — never from user input.
 *
 * This module is server-only by construction (it pulls in the pooled DB
 * client). Import it from server actions and route handlers only.
 */

export type { Monitor } from "@pulse/db";

export function listMonitors(
  accountId: string,
  dbh?: PulseDb,
): Promise<Monitor[]> {
  return monitorsRepo.listMonitors(accountId, dbh);
}

export function getMonitor(
  accountId: string,
  id: string,
  dbh?: PulseDb,
): Promise<Monitor | undefined> {
  return monitorsRepo.getMonitor(accountId, id, dbh);
}

/**
 * Create a monitor, enforcing the per-account cap. Throws `MonitorError`
 * ("limit_reached") when the account is at the limit so callers can surface a
 * clear message (HTTP 409 / inline error) rather than silently growing.
 */
export async function createMonitor(
  accountId: string,
  fields: CreateMonitorFields,
  dbh?: PulseDb,
): Promise<Monitor> {
  const existing = await monitorsRepo.countMonitors(accountId, dbh);
  if (existing >= MAX_MONITORS_PER_ACCOUNT) {
    throw new MonitorError(
      "limit_reached",
      `You've reached the limit of ${MAX_MONITORS_PER_ACCOUNT} monitors.`,
    );
  }
  return monitorsRepo.createMonitor(
    accountId,
    {
      name: fields.name,
      target: fields.target,
      method: fields.method,
      intervalSeconds: fields.intervalSeconds,
      expectedStatusCode: fields.expectedStatusCode,
      enabled: fields.enabled,
    },
    dbh,
  );
}

export function updateMonitor(
  accountId: string,
  id: string,
  fields: UpdateMonitorFields,
  dbh?: PulseDb,
): Promise<Monitor | undefined> {
  return monitorsRepo.updateMonitor(
    accountId,
    id,
    {
      name: fields.name,
      target: fields.target,
      method: fields.method,
      intervalSeconds: fields.intervalSeconds,
      expectedStatusCode: fields.expectedStatusCode,
      enabled: fields.enabled,
    },
    dbh,
  );
}

export function deleteMonitor(
  accountId: string,
  id: string,
  dbh?: PulseDb,
): Promise<boolean> {
  return monitorsRepo.deleteMonitor(accountId, id, dbh);
}
