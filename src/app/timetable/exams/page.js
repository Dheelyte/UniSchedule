'use client';

import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { detectAllConflicts } from '@/lib/conflicts';
import { exportTimetablePDF } from '@/lib/pdfExport';
import TimetableGrid from '@/components/TimetableGrid/TimetableGrid';
import { useToast } from '@/components/Toast/Toast';
import ExportModal from '@/components/ExportModal/ExportModal';
import styles from './exams.module.css';

export default function ExamTimetablePage() {
    const { getSchedulesWithDetails, state } = useApp();
    const { addToast } = useToast();

    const [isExportModalOpen, setIsExportModalOpen] = useState(false);

    const handleExportInit = () => {
        const schedules = getSchedulesWithDetails.filter((s) => s.type === 'exam');

        // Prevent export if conflicts exist
        const conflictsMap = detectAllConflicts(schedules);
        const hasErrors = Array.from(conflictsMap.values()).some((conflicts) =>
            conflicts.some((c) => c.severity === 'error')
        );

        if (hasErrors) {
            addToast({ type: 'error', title: 'Export Failed', message: 'Please resolve all schedule conflicts before exporting.' });
            return;
        }
        setIsExportModalOpen(true);
    };

    const handleExportConfirm = ({ session, semester, facultyId }) => {
        setIsExportModalOpen(false);
        const allExams = getSchedulesWithDetails.filter((s) => s.type === 'exam');

        const filteredSchedules = facultyId === 'ALL'
            ? allExams
            : allExams.filter(s => s.facultyId === facultyId);

        if (filteredSchedules.length === 0) {
            addToast({ type: 'error', title: 'Export Failed', message: 'No schedules found for the selected faculty.' });
            return;
        }

        const facultyInfo = facultyId === 'ALL'
            ? 'All Faculties'
            : state.faculties.find(f => f.id === facultyId)?.name || 'Unknown Faculty';

        exportTimetablePDF({
            schedules: filteredSchedules,
            rooms: state.rooms,
            title: 'Examination Timetable',
            session,
            semester,
            faculty: facultyInfo,
            schoolName: 'University of Lagos',
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
                    <button className="btn btn-secondary" onClick={handleExportInit}>
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
            <ExportModal
                isOpen={isExportModalOpen}
                onClose={() => setIsExportModalOpen(false)}
                onExport={handleExportConfirm}
                mode="exam"
            />
        </div>
    );
}
