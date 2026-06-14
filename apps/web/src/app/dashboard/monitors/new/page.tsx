import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { MonitorForm } from "../MonitorForm";
import { createMonitorAction } from "../actions";
import styles from "../monitors.module.css";

export const metadata: Metadata = {
  title: "New monitor · Pulse",
};

/** Create-a-monitor page. `requireSession` guards it; the action re-derives the
 * account from the session, so this page passes no tenancy info itself. */
export default async function NewMonitorPage() {
  await requireSession();

  return (
    <div className={styles.shell}>
      <header className={styles.nav}>
        <Link className={styles.brand} href="/dashboard">
          <span className={styles.dot} aria-hidden="true" />
          pulse
        </Link>
      </header>

      <main className={styles.formMain}>
        <p className={styles.eyebrow}>
          <Link className={styles.backLink} href="/dashboard/monitors">
            Monitors
          </Link>{" "}
          / New
        </p>
        <h1 className={styles.title}>Add a monitor</h1>
        <p className={styles.lede}>
          Point Pulse at an HTTP endpoint and choose how often to check it.
        </p>

        <MonitorForm
          action={createMonitorAction}
          submitLabel="Create monitor"
          pendingLabel="Creating…"
        />
      </main>
    </div>
  );
}
