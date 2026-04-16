'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import styles from './page.module.css';

export default function Home() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <div className={styles.logo}>SAU</div>
        <div className={styles.statusBadge}>
          <span className={styles.pulseDot}></span>
          Opérationnel
        </div>
      </header>

      <section className={styles.hero}>
        <h1 className={styles.title}>Système d'Alerte d'Urgence</h1>
        <p className={styles.subtitle}>
          Localisation instantanée. Intervention immédiate.
        </p>
      </section>

      <div className={styles.actions}>
        <Link href="/alert" className="btn-sos pulse" id="btn-sos-main">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          SIGNALER UNE URGENCE
        </Link>
        
        <p className={styles.notice}>
          En appuyant, vous autorisez le partage de votre position GPS avec les secours.
        </p>
      </div>

      <footer className={styles.footer}>
      </footer>
    </main>
  );
}
