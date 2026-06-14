import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { logOutAction } from "../(auth)/actions";
import styles from "./dashboard.module.css";

export const metadata: Metadata = {
  title: "Dashboard · Pulse",
};

/**
 * Authenticated home. Server-rendered: `requireSession()` resolves the session
 * cookie to the tenant context (user + owning account) or redirects to /login.
 *
 * Everything shown here is derived from that single account-scoped context —
 * the pattern every future feature (monitors, incidents) follows so data stays
 * isolated per account.
 */
export default async function DashboardPage() {
  const { user, account } = await requireSession();
  const memberSince = account.createdAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className={styles.shell}>
      <header className={styles.nav}>
        <Link className={styles.brand} href="/">
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
        <p className={styles.eyebrow}>Account · {account.name}</p>
        <h1 className={styles.title}>
          Welcome to <em>{account.name}</em>.
        </h1>
        <p className={styles.lede}>
          You&rsquo;re signed in as {user.email}. This is your account&rsquo;s
          private workspace. Spin up your first HTTP monitor to start tracking
          uptime.
        </p>

        <p>
          <Link className={styles.cta} href="/dashboard/monitors">
            Manage monitors →
          </Link>
        </p>

        <dl className={styles.meta}>
          <div className={styles.metaItem}>
            <dt className={styles.metaLabel}>Account</dt>
            <dd className={styles.metaValue}>{account.name}</dd>
          </div>
          <div className={styles.metaItem}>
            <dt className={styles.metaLabel}>Signed in as</dt>
            <dd className={styles.metaValue}>{user.email}</dd>
          </div>
          <div className={styles.metaItem}>
            <dt className={styles.metaLabel}>Created</dt>
            <dd className={styles.metaValue}>{memberSince}</dd>
          </div>
        </dl>
      </main>
    </div>
  );
}
