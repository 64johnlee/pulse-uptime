import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getMonitor } from "@/lib/monitors/service";
import { MonitorForm } from "../../MonitorForm";
import { updateMonitorAction } from "../../actions";
import styles from "../../monitors.module.css";

export const metadata: Metadata = {
  title: "Edit monitor · Pulse",
};

type PageProps = { params: Promise<{ id: string }> };

/**
 * Edit-a-monitor page. The monitor is loaded account-scoped; an id that isn't
 * this tenant's reads as 404 (`getMonitor` returns undefined). The update
 * action is bound to the monitor id so the client form just submits fields.
 */
export default async function EditMonitorPage({ params }: PageProps) {
  const { account } = await requireSession();
  const { id } = await params;
  const monitor = await getMonitor(account.id, id);
  if (!monitor) notFound();

  const action = updateMonitorAction.bind(null, monitor.id);

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
          / Edit
        </p>
        <h1 className={styles.title}>Edit monitor</h1>
        <p className={styles.lede}>Update how Pulse checks this endpoint.</p>

        <MonitorForm
          action={action}
          submitLabel="Save changes"
          pendingLabel="Saving…"
          defaults={{
            name: monitor.name,
            target: monitor.target,
            method: monitor.method,
            intervalSeconds: monitor.intervalSeconds,
            expectedStatusCode: monitor.expectedStatusCode,
            enabled: monitor.enabled,
          }}
        />
      </main>
    </div>
  );
}
