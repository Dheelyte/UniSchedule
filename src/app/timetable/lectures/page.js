'use client';

import { useApp } from '@/context/AppContext';
import { exportTimetablePDF } from '@/lib/pdfExport';
import TimetableGrid from '@/components/TimetableGrid/TimetableGrid';
import { useToast } from '@/components/Toast/Toast';
import styles from './lectures.module.css';

export default function LectureTimetablePage() {
    const { getSchedulesWithDetails, state } = useApp();
    const { addToast } = useToast();

    const handleExport = () => {
        const schedules = getSchedulesWithDetails.filter((s) => s.type === 'lecture');
        exportTimetablePDF({
            schedules,
            title: 'Lecture Timetable',
            subtitle: `University of Lagos — ${state.faculties.length} Faculties, ${schedules.length} Lectures`,
            mode: 'lecture',
        });
        addToast({ type: 'success', title: 'PDF Exported', message: 'Lecture timetable downloaded as PDF.' });
    };

    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <div>
                    <h2 className={styles.pageTitle}>Lecture Timetable</h2>
                    <p className={styles.pageSub}>
                        View and manage the weekly lecture schedule. Click on any time slot to add a new lecture.
                    </p>
                </div>
                <div className={styles.headerActions}>
                    <button className="btn btn-secondary" onClick={handleExport}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        Export PDF
                    </button>
                    <div className={styles.modeBadge}>
                        <span className={styles.modeDot} />
                        Lecture Mode
                    </div>
                </div>
            </div>
            <TimetableGrid mode="lecture" />
        </div>
    );
}
