'use client';

import { useState, useEffect, useCallback } from 'react';
import { useApp, ACTION_TYPES } from '@/context/AppContext';
import { apiClient } from '@/lib/apiClient';
import { detectAllConflicts } from '@/lib/conflicts';
import { exportTimetablePDF } from '@/lib/pdfExport';
import TimetableGrid from '@/components/TimetableGrid/TimetableGrid';
import { useToast } from '@/components/Toast/Toast';
import ExportModal from '@/components/ExportModal/ExportModal';
import { TimetableSkeleton } from '@/components/Skeleton/Skeleton';
import styles from './exams.module.css';

export default function ExamTimetablePage() {
    const { getSchedulesWithDetails, state, dispatch } = useApp();
    const { addToast } = useToast();

    const [sessions, setSessions] = useState([]);
    const [semesters, setSemesters] = useState([]);
    const [selectedSemesterId, setSelectedSemesterId] = useState(null);
    const [isExportModalOpen, setIsExportModalOpen] = useState(false);

    useEffect(() => {
        async function loadTerms() {
            try {
                const sessList = await apiClient.get('/calendar/sessions').catch(() => []);
                setSessions(sessList);
                let allSems = [];
                for (const s of sessList) {
                    const sems = await apiClient.get(`/calendar/sessions/${s.id}/semesters`).catch(() => []);
                    allSems.push(...sems.map(sem => ({ ...sem, sessionName: s.name })));
                }
                setSemesters(allSems);
                const current = await apiClient.get('/calendar/semesters/current').catch(() => null);
                if (current) {
                    setSelectedSemesterId(current.id);
                } else if (allSems.length > 0) {
                    setSelectedSemesterId(allSems[0].id);
                }
            } catch (e) { console.error(e); }
        }
        loadTerms();
    }, []);

    const loadSchedules = useCallback(async (semId) => {
        if (semId === null) return;
        try {
            const [faculties, departments, rooms, courses, scheduleItems] = await Promise.all([
                apiClient.get('/timetable/faculties').catch(() => []),
                apiClient.get('/timetable/departments').catch(() => []),
                apiClient.get('/timetable/rooms').catch(() => []),
                apiClient.get('/timetable/courses').catch(() => []),
                apiClient.get(`/timetable/schedule-items?semester_id=${semId}`).catch(() => [])
            ]);
            dispatch({
                type: ACTION_TYPES.INIT_STATE,
                payload: {
                    faculties: faculties || [],
                    departments: (departments || []).map(d => ({ ...d, facultyId: d.faculty_id })),
                    rooms: rooms || [],
                    courses: (courses || []).map(c => ({ ...c, creditLoad: c.credit_load, departmentId: c.department_id })),
                    scheduleItems: (scheduleItems || []).map(s => ({
                        ...s,
                        courseId: s.course_id,
                        roomIds: s.room_ids,
                        facultyId: s.faculty_id,
                        day: s.day_of_week,
                        startTime: s.start_time,
                        endTime: s.end_time
                    }))
                }
            });
        } catch (e) { console.error(e); }
    }, [dispatch]);

    useEffect(() => {
        if (selectedSemesterId !== null) loadSchedules(selectedSemesterId);
    }, [selectedSemesterId, loadSchedules]);

    const handleExportInit = () => {
        const schedules = getSchedulesWithDetails.filter((s) => s.type === 'exam');
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
        const filteredSchedules = facultyId === 'ALL' ? allExams : allExams.filter(s => s.facultyId === facultyId);
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

    if (selectedSemesterId === null) return <TimetableSkeleton />;

    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <div />
                <div className={styles.headerActions}>
                    {semesters.length > 0 && (
                        <select
                            className="form-input"
                            style={{ minWidth: '240px' }}
                            value={selectedSemesterId ?? ''}
                            onChange={e => setSelectedSemesterId(parseInt(e.target.value))}
                        >
                            {semesters.map(s => (
                                <option key={s.id} value={s.id}>
                                    {s.sessionName} — {s.name}{s.is_current ? ' (Current)' : ''}
                                </option>
                            ))}
                        </select>
                    )}
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
            <TimetableGrid mode="exam" semesterId={selectedSemesterId} readOnly={semesters.find(s => s.id === selectedSemesterId)?.is_current === false} />
            <ExportModal
                isOpen={isExportModalOpen}
                onClose={() => setIsExportModalOpen(false)}
                onExport={handleExportConfirm}
                mode="exam"
                sessions={sessions}
            />
        </div>
    );
}
