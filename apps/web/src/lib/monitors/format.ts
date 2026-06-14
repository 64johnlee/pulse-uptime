/**
 * Pure display helpers for monitors. Kept separate from React so they can be
 * unit-tested and reused by the list, detail, and (later) status-page views.
 */

/** Human label for a check interval expressed in seconds. */
export function formatInterval(seconds: number): string {
  if (seconds < 60) return `every ${seconds}s`;
  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60);
    return `every ${minutes} min`;
  }
  const hours = Math.round(seconds / 3600);
  return hours === 1 ? "every hour" : `every ${hours} hr`;
}

export type MonitorStatus = "up" | "down" | "paused" | "unknown";

/** Short label for a rolled-up monitor status. */
export function statusLabel(status: MonitorStatus): string {
  switch (status) {
    case "up":
      return "Up";
    case "down":
      return "Down";
    case "paused":
      return "Paused";
    default:
      return "Pending";
  }
}
