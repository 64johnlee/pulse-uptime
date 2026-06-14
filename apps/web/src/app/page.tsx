import styles from "./page.module.css";

/**
 * Placeholder landing page for Pulse. Intentional "signal monitor" direction
 * (deep ink canvas, uptime-green accent, mono/sans pairing) rather than a
 * generic centered hero — this is the visual seed the real marketing site and
 * status pages grow from.
 */
const stats = [
  { label: "Uptime / 90d", value: "99.98%", tone: "up" as const },
  { label: "Checks / min", value: "12.4k", tone: "up" as const },
  { label: "P50 latency", value: "84ms", tone: "up" as const },
];

export default function HomePage() {
  return (
    <div className={styles.shell}>
      <header className={styles.nav}>
        <span className={styles.brand}>
          <span className={styles.dot} aria-hidden="true" />
          pulse
        </span>
        <nav aria-label="Primary" className={styles.navLinks}>
          <a className={styles.navLink} href="/api/health">
            status
          </a>
          <a className={styles.navLink} href="/login">
            log in
          </a>
          <a className={styles.navCta} href="/signup">
            get started
          </a>
        </nav>
      </header>

      <main className={styles.hero}>
        <p className={styles.eyebrow}>Uptime monitoring · status pages</p>
        <h1 className={styles.title}>
          Know the moment it <em>breaks</em>.
        </h1>
        <p className={styles.lede}>
          Fast, clean, developer-first uptime monitoring and beautiful public
          status pages — without the bloated price tag. This is the v1
          scaffold; features land next.
        </p>

        <div className={styles.signal} aria-hidden="true">
          <svg
            className={styles.signalSvg}
            viewBox="0 0 600 84"
            preserveAspectRatio="none"
          >
            <path
              className={styles.signalPath}
              d="M0 50 H120 L140 50 L150 22 L162 64 L174 50 H300 L318 50 L328 30 L340 58 L350 50 H600"
            />
          </svg>
          <span className={styles.sweep} />
        </div>

        <section className={styles.statusRow} aria-label="Sample metrics">
          {stats.map((s) => (
            <article key={s.label} className={styles.stat}>
              <div className={styles.statLabel}>{s.label}</div>
              <div className={styles.statValue} data-tone={s.tone}>
                {s.value}
              </div>
            </article>
          ))}
        </section>
      </main>

      <footer className={styles.footer}>
        <span>Pulse · v0 scaffold</span>
        <span>built for small teams that ship</span>
      </footer>
    </div>
  );
}
