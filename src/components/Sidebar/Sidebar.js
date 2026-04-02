'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import styles from './Sidebar.module.css';

const navItems = [
  {
    label: 'Dashboard',
    href: '/',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    label: 'Faculties & Departments',
    href: '/faculties',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 20V8l10-5 10 5v12" />
        <path d="M6 10v10" />
        <path d="M18 10v10" />
        <path d="M2 20h20" />
        <path d="M9 20v-4a3 3 0 0 1 6 0v4" />
      </svg>
    ),
  },
  {
    label: 'Courses',
    href: '/courses',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        <line x1="9" y1="7" x2="16" y2="7" />
        <line x1="9" y1="11" x2="14" y2="11" />
      </svg>
    ),
  },
  {
    label: 'Rooms',
    href: '/rooms',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  { type: 'divider', label: 'Timetables' },
  {
    label: 'Lecture Timetable',
    href: '/timetable/lectures',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <line x1="10" y1="14" x2="14" y2="14" />
        <line x1="10" y1="18" x2="14" y2="18" />
      </svg>
    ),
  },
  {
    label: 'Exam Timetable',
    href: '/timetable/exams',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <rect x="8" y="2" width="8" height="4" rx="1" />
        <path d="M9 14l2 2 4-4" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className={styles.sidebar}>
      {/* Brand */}
      <div className={styles.brand}>
        <div className={styles.logo}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <defs>
              <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#818cf8" />
                <stop offset="100%" stopColor="#06b6d4" />
              </linearGradient>
            </defs>
            <rect x="2" y="2" width="20" height="20" rx="4" stroke="url(#logoGrad)" strokeWidth="2" />
            <path d="M7 8h10M7 12h7M7 16h10" stroke="url(#logoGrad)" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <div className={styles.brandText}>
          <span className={styles.brandName}>UnilagSchedule</span>
          <span className={styles.brandSub}>Timetable Manager</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className={styles.nav}>
        {navItems.map((item, index) => {
          if (item.type === 'divider') {
            return (
              <div key={index} className={styles.divider}>
                <span>{item.label}</span>
              </div>
            );
          }

          const isActive =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
            >
              <span className={styles.navIcon}>{item.icon}</span>
              <span className={styles.navLabel}>{item.label}</span>
              {isActive && <span className={styles.activeIndicator} />}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className={styles.sidebarFooter}>
        <div className={styles.footerCard}>
          <div className={styles.footerIcon}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
            </svg>
          </div>
          <div className={styles.footerText}>
            <span className={styles.footerTitle}>Phase 1</span>
            <span className={styles.footerDesc}>UI Layout Shell</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
