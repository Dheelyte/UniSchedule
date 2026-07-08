'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { unilagLogoBase64 } from '@/lib/logo';
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
    roles: ['SUPER_ADMIN', 'SUPER_VIEWER', 'FACULTY_EDITOR', 'FACULTY_VIEWER', 'GS_ADMIN', 'CITS_ADMIN'],
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
    roles: ['SUPER_ADMIN', 'SUPER_VIEWER', 'FACULTY_EDITOR', 'FACULTY_VIEWER', 'GS_ADMIN', 'CITS_ADMIN'],
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
    roles: ['SUPER_ADMIN', 'SUPER_VIEWER', 'FACULTY_EDITOR', 'FACULTY_VIEWER', 'GS_ADMIN', 'CITS_ADMIN'],
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
  {
    label: 'CBT Timetable',
    href: '/timetable/cbt',
    roles: ['CITS_ADMIN'],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <line x1="9" y1="9" x2="15" y2="9" />
        <line x1="9" y1="13" x2="15" y2="13" />
        <line x1="9" y1="17" x2="13" y2="17" />
      </svg>
    ),
  },
  { type: 'divider', label: 'Management', roles: ['SUPER_ADMIN'] },
  {
    label: 'Academic Terms',
    href: '/terms',
    roles: ['SUPER_ADMIN'],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    label: 'Staff',
    href: '/staff',
    roles: ['SUPER_ADMIN'],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    label: 'Change Requests',
    href: '/requests',
    roles: ['SUPER_ADMIN', 'SUPER_VIEWER'],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <path d="M9 15l2 2 4-4" />
      </svg>
    ),
  },
  {
    label: 'Activity Logs',
    href: '/activity',
    roles: ['SUPER_ADMIN', 'SUPER_VIEWER'],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" />
        <path d="M7 14l3-3 3 3 5-5" />
      </svg>
    ),
  },
];

export default function Sidebar({ isCollapsed, isMobileOpen = false, onMobileClose }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const role = user?.role;

  const isAllowed = (item) => {
    if (!item.roles) return true; // no restriction = visible to all
    if (!role) return false;
    return item.roles.includes(role);
  };

  const handleNavClick = () => { if (onMobileClose) onMobileClose(); };

  return (
    <aside className={`${styles.sidebar} ${isCollapsed ? styles.collapsed : ''} ${isMobileOpen ? styles.mobileOpen : ''}`}>
      {/* Brand */}
      <div className={styles.brand}>
        <div className={styles.logo}>
          <img src={unilagLogoBase64} alt="UNILAG Logo" width="32" height="32" style={{ borderRadius: '4px', objectFit: 'contain' }} />
        </div>
        {!isCollapsed && (
          <div className={styles.brandText}>
            <span className={styles.brandName}>University of Lagos</span>
            <span className={styles.brandSub}>Timetable Manager</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className={styles.nav}>
        {navItems.map((item, index) => {
          if (!isAllowed(item)) return null;

          if (item.type === 'divider') {
            return !isCollapsed ? (
              <div key={index} className={styles.divider}>
                <span>{item.label}</span>
              </div>
            ) : <div key={index} className={styles.dividerSpacer} />;
          }

          const isActive =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.navItem} ${isActive ? styles.navItemActive : ''} ${isCollapsed ? styles.navItemCollapsed : ''}`}
              title={isCollapsed ? item.label : undefined}
              onClick={handleNavClick}
            >
              <span className={styles.navIcon}>{item.icon}</span>
              {!isCollapsed && <span className={styles.navLabel}>{item.label}</span>}
              {isActive && !isCollapsed && <span className={styles.activeIndicator} />}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
