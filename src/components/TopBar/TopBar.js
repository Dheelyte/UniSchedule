'use client';

import { usePathname } from 'next/navigation';
import styles from './TopBar.module.css';

const pageTitles = {
    '/': 'Dashboard',
    '/faculties': 'Faculties & Departments',
    '/courses': 'Course Registry',
    '/rooms': 'Room Registry',
    '/timetable/lectures': 'Lecture Timetable',
    '/timetable/exams': 'Exam Timetable',
};

export default function TopBar() {
    const pathname = usePathname();
    const title = pageTitles[pathname] || 'Dashboard';

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-NG', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });

    return (
        <header className={styles.topbar}>
            <div className={styles.left}>
                <h1 className={styles.title}>{title}</h1>
                <span className={styles.date}>{dateStr}</span>
            </div>

            <div className={styles.right}>
                {/* Search */}
                <div className={styles.search}>
                    <svg className={styles.searchIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                        type="text"
                        className={styles.searchInput}
                        placeholder="Search courses, rooms..."
                    />
                    <kbd className={styles.kbd}>⌘K</kbd>
                </div>

                {/* Notifications */}
                <button className={styles.iconBtn} title="Notifications">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                    <span className={styles.notifDot} />
                </button>

                {/* User Avatar */}
                <button className={styles.avatar}>
                    <span>AD</span>
                </button>
            </div>
        </header>
    );
}
