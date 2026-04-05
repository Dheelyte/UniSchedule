'use client';

import styles from './page.module.css';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';

export default function DashboardPage() {
  const { stats } = useApp();

  return (
    <div className={styles.dashboard}>

      <div className={styles.layoutContainer}>
        {/* Primary Actions: Timetables */}
        <section className={styles.actionsSection}>
          <div className={styles.primaryGrid}>
            <Link href="/timetable/lectures" className={`${styles.navCard} ${styles.primaryCard}`}>
              <div className={styles.cardHeader}>
                <div className={`${styles.navIcon} ${styles.metricIconPurple}`}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </div>
                <span className={styles.navArrow}>→</span>
              </div>
              <div className={styles.navText}>
                <h3 className={styles.navTitle}>Create Lecture Timetable</h3>
                <p className={styles.navDesc}>Schedule weekly courses interactively with intelligent conflict highlighting and room capacities mapped directly to blocks.</p>
              </div>
            </Link>

            <Link href="/timetable/exams" className={`${styles.navCard} ${styles.primaryCard}`}>
              <div className={styles.cardHeader}>
                <div className={`${styles.navIcon} ${styles.metricIconOrange}`}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                    <rect x="8" y="2" width="8" height="4" rx="1" />
                  </svg>
                </div>
                <span className={styles.navArrow}>→</span>
              </div>
              <div className={styles.navText}>
                <h3 className={styles.navTitle}>Create Exam Timetable</h3>
                <p className={styles.navDesc}>Generate one-off examination sessions spanned dynamically across multi-week layouts operating up to Saturdays.</p>
              </div>
            </Link>
          </div>
        </section>

        {/* Secondary Actions: Configuration */}
        <section className={styles.actionsSection}>
          <div className={styles.secondaryGrid}>
            <Link href="/rooms" className={styles.navCard}>
              <div className={`${styles.navIcon} ${styles.metricIconCyan}`}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              </div>
              <div className={styles.navText}>
                <h3 className={styles.navTitle}>Manage Rooms</h3>
                <p className={styles.navDesc}>View and edit locations across campus.</p>
              </div>
            </Link>

            <Link href="/courses" className={styles.navCard}>
              <div className={`${styles.navIcon} ${styles.metricIconGreen}`}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </div>
              <div className={styles.navText}>
                <h3 className={styles.navTitle}>Manage Courses</h3>
                <p className={styles.navDesc}>Register and configure new courses.</p>
              </div>
            </Link>

            <Link href="/faculties" className={styles.navCard}>
              <div className={`${styles.navIcon} ${styles.metricIconPurple}`}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 20V8l10-5 10 5v12" />
                  <path d="M6 10v10" />
                  <path d="M18 10v10" />
                  <path d="M2 20h20" />
                </svg>
              </div>
              <div className={styles.navText}>
                <h3 className={styles.navTitle}>Faculties & Depts</h3>
                <p className={styles.navDesc}>Organize academic structure globally.</p>
              </div>
            </Link>
          </div>
        </section>
      </div>

    </div>
  );
}
