'use client';

import { useApp } from '@/context/AppContext';
import { exportTimetablePDF } from '@/lib/pdfExport';
import TimetableGrid from '@/components/TimetableGrid/TimetableGrid';
import { useToast } from '@/components/Toast/Toast';
import styles from './exams.module.css';

export default function ExamTimetablePage() {
    const { getSchedulesWithDetails, state } = useApp();
    const { addToast } = useToast();

    const handleExport = () => {
        const schedules = getSchedulesWithDetails.filter((s) => s.type === 'exam');
        exportTimetablePDF({
            schedules,
            title: 'Examination Timetable',
            subtitle: `University of Lagos — ${state.faculties.length} Faculties, ${schedules.length} Exams`,
            mode: 'exam',
        });
        addToast({ type: 'success', title: 'PDF Exported', message: 'Exam timetable downloaded as PDF.' });
    };

    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <div>
                    <h2 className={styles.pageTitle}>Exam Timetable</h2>
                    <p className={styles.pageSub}>
                        Schedule and manage examination sessions. Click on any time slot to schedule an exam.
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
                        Examination Mode
                    </div>
                </div>
            </div>
            <TimetableGrid mode="exam" />
        </div>
    );
}
