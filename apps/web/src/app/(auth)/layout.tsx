import Link from "next/link";
import styles from "./auth.module.css";

/**
 * Shared chrome for the unauthenticated auth surfaces (login / signup): the
 * brand header plus the centered-but-left-aligned editorial column. Keeps the
 * "signal monitor" visual language from the landing page.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <header className={styles.nav}>
        <Link className={styles.brand} href="/">
          <span className={styles.dot} aria-hidden="true" />
          pulse
        </Link>
        <nav aria-label="Primary">
          <a className={styles.navLink} href="/api/health">
            status
          </a>
        </nav>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
