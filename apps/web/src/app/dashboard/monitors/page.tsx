import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { listMonitors } from "@/lib/monitors/service";
import { formatInterval, statusLabel } from "@/lib/monitors/format";
import { logOutAction } from "../../(auth)/actions";
import { deleteMonitorAction } from "./actions";
import styles from "./monitors.module.css";

export const metadata: Metadata = {
  title: "Monitors · Pulse",
};

/**
 * Monitors index. Server-rendered and account-scoped via `requireSession()` —
 * the list is read straight from the tenant's monitors, so it persists across
 * reloads (the JJC-6 success condition). Create/edit/delete hang off this page.
 */
export default async function MonitorsPage() {
  const { account } = await requireSession();
  const monitors = await listMonitors(account.id);

  return (
    <div className={styles.shell}>
      <header className={styles.nav}>
        <Link className={styles.brand} href="/dashboard">
          <span className={styles.dot} aria-hidden="true" />
          pulse
        </Link>
        <form action={logOutAction}>
          <button className={styles.logout} type="submit">
            Log out
          </button>
        </form>
      </header>

      <main className={styles.main}>
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Monitors</p>
            <h1 className={styles.title}>Your checks</h1>
          </div>
          <Link className={styles.newButton} href="/dashboard/monitors/new">
            New monitor
          </Link>
        </div>

        {monitors.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No monitors yet.</p>
            <p className={styles.emptyLede}>
              Add an HTTP endpoint and Pulse will start checking it on a
              schedule.
            </p>
            <Link className={styles.newButton} href="/dashboard/monitors/new">
              Add your first monitor
            </Link>
          </div>
        ) : (
          <ul className={styles.list}>
            {monitors.map((monitor) => (
              <li key={monitor.id} className={styles.item}>
                <span
                  className={`${styles.status} ${styles[`status_${monitor.status}`]}`}
                  title={statusLabel(monitor.status)}
                >
                  <span className={styles.statusDot} aria-hidden="true" />
                  {statusLabel(monitor.status)}
                </span>

                <div className={styles.itemBody}>
                  <p className={styles.itemName}>{monitor.name}</p>
                  <p className={styles.itemTarget}>
                    <span className={styles.method}>{monitor.method}</span>
                    {monitor.target}
                  </p>
                </div>

                <span className={styles.interval}>
                  {monitor.enabled
                    ? formatInterval(monitor.intervalSeconds)
                    : "paused"}
                </span>

                <div className={styles.itemActions}>
                  <Link
                    className={styles.editLink}
                    href={`/dashboard/monitors/${monitor.id}/edit`}
                  >
                    Edit
                  </Link>
                  <form action={deleteMonitorAction}>
                    <input type="hidden" name="id" value={monitor.id} />
                    <button className={styles.deleteButton} type="submit">
                      Delete
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
