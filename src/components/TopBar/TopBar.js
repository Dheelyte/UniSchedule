'use client';

import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useConfirm } from '@/components/ConfirmModal/ConfirmContext';
import styles from './TopBar.module.css';

const pageTitles = {
    '/': { title: 'Dashboard', subtitle: 'Overview of your timetable system' },
    '/faculties': { title: 'Faculties & Departments', subtitle: 'Manage faculties and their associated departments' },
    '/courses': { title: 'Course Registry', subtitle: 'Register and manage courses across departments' },
    '/rooms': { title: 'Room Registry', subtitle: 'Manage venues and their capacities' },
    '/timetable/lectures': { title: 'Lecture Timetable', subtitle: 'View and manage the weekly lecture schedule' },
    '/timetable/exams': { title: 'Exam Timetable', subtitle: 'Schedule and manage examination sessions' },
    '/staff': { title: 'Staff Management', subtitle: 'Manage staff accounts and permissions' },
    '/terms': { title: 'Academic Terms', subtitle: 'Configure academic sessions and semesters' },
};

export default function TopBar({ isSidebarCollapsed, toggleCollapse }) {
    const pathname = usePathname();
    const { user, logout } = useAuth();
    const confirm = useConfirm();
    const pageInfo = pageTitles[pathname] || { title: 'Dashboard', subtitle: '' };

    return (
        <header
            className={styles.topbar}
            style={{
                left: isSidebarCollapsed ? 'var(--sidebar-collapsed-width)' : 'var(--sidebar-width)',
                transition: 'left var(--transition-base)',
            }}
        >
            <div className={styles.left}>
                <button className={styles.toggleBtn} onClick={toggleCollapse} title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="3" y1="6" x2="21" y2="6" />
                        <line x1="3" y1="12" x2="21" y2="12" />
                        <line x1="3" y1="18" x2="21" y2="18" />
                    </svg>
                </button>
                <div className={styles.titleInfo}>
                    <h1 className={styles.title}>{pageInfo.title}</h1>
                    {pageInfo.subtitle && <span className={styles.subtitle}>{pageInfo.subtitle}</span>}
                </div>
            </div>

            <div className={styles.right}>
                {/* Logout Button */}
                <button className={styles.logoutBtn} onClick={async () => {
                    if (await confirm("Are you sure you want to log out?")) {
                        logout();
                    }
                }} title={`Logout: ${user?.email || 'User'}`}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                </button>
            </div>
        </header>
    );
}
