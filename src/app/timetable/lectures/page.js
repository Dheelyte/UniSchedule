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
import styles from './lectures.module.css';

export default function LectureTimetablePage() {
    const { getSchedulesWithDetails, state, dispatch } = useApp();
    const { addToast } = useToast();

    const [sessions, setSessions] = useState([]);
    const [semesters, setSemesters] = useState([]);
    const [selectedSemesterId, setSelectedSemesterId] = useState(null);
<<<<<<< HEAD
=======
    const [semesterLabel, setSemesterLabel] = useState('');
    const [blockedSlots, setBlockedSlots] = useState([]);
>>>>>>> 6156905 (Reset database)
    const [isExportModalOpen, setIsExportModalOpen] = useState(false);

    // ✅ Activity Logger
    const logActivity = async (action) => {
        try {
            await apiClient.post('/logs', {
                action,
                timestamp: new Date().toISOString()
            });
        } catch (err) {
            console.error("Log failed", err);
        }
    };

    // Load sessions/semesters
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
            } catch (e) {
                console.error(e);
            }
        }

        loadTerms();
    }, []);

    const loadSchedules = useCallback(async (semId) => {
        if (semId === null) return;

        try {
            const [faculties, departments, rooms, courses, scheduleItems, blockedSlotsData] = await Promise.all([
                apiClient.get('/timetable/faculties').catch(() => []),
                apiClient.get('/timetable/departments').catch(() => []),
                apiClient.get('/timetable/rooms').catch(() => []),
                apiClient.get('/timetable/courses').catch(() => []),
                apiClient.get(`/timetable/schedule-items?semester_id=${semId}`).catch(() => []),
                apiClient.get(`/timetable/blocked-slots?semester_id=${semId}`).catch(() => [])
            ]);

            dispatch({
                type: ACTION_TYPES.INIT_STATE,
                payload: {
                    faculties: faculties || [],
                    departments: (departments || []).map(d => ({ ...d, facultyId: d.faculty_id })),
                    rooms: rooms || [],
                    courses: (courses || []).map(c => ({
                        ...c,
                        creditLoad: c.credit_load,
                        departmentId: c.department_id
                    })),
                    scheduleItems: (scheduleItems || []).map(s => ({
                        ...s,
                        courseId: s.course_id,
                        roomIds: s.room_ids,
                        facultyId: s.faculty_id,
                        day: s.day_of_week,
                        examDate: s.exam_date,
                        startTime: s.start_time,
                        endTime: s.end_time
                    }))
                }
            });
<<<<<<< HEAD
        } catch (e) {
            console.error(e);
        }
=======
            setBlockedSlots(blockedSlotsData || []);
        } catch (e) { console.error(e); }
>>>>>>> 6156905 (Reset database)
    }, [dispatch]);

    useEffect(() => {
        if (selectedSemesterId !== null) {
            loadSchedules(selectedSemesterId);
        }
    }, [selectedSemesterId, loadSchedules]);

    // PDF export
    const handleExportInit = () => {
        const schedules = getSchedulesWithDetails.filter((s) => s.type === 'lecture');

        const conflictsMap = detectAllConflicts(schedules);
        const hasErrors = Array.from(conflictsMap.values()).some((conflicts) =>
            conflicts.some((c) => c.severity === 'error')
        );

        if (hasErrors) {
            addToast({
                type: 'error',
                title: 'Export Failed',
                message: 'Please resolve all schedule conflicts before exporting.'
            });
            return;
        }

        setIsExportModalOpen(true);
    };

    const handleExportConfirm = async ({ session, semester, facultyId }) => {
        setIsExportModalOpen(false);

        const allLectures = getSchedulesWithDetails.filter((s) => s.type === 'lecture');

        const filteredSchedules =
            facultyId === 'ALL'
                ? allLectures
                : allLectures.filter(s => s.facultyId === facultyId);

        if (filteredSchedules.length === 0) {
            addToast({
                type: 'error',
                title: 'Export Failed',
                message: 'No schedules found for the selected faculty.'
            });
            return;
        }

<<<<<<< HEAD
        const facultyInfo =
            facultyId === 'ALL'
                ? 'All Faculties'
                : state.faculties.find(f => f.id === facultyId)?.name || 'Unknown Faculty';
=======
        const blockedSlots = await apiClient.get(`/timetable/blocked-slots?semester_id=${selectedSemesterId}`).catch(() => []);

        const facultyInfo = facultyId === 'ALL'
            ? 'All Faculties'
            : state.faculties.find(f => f.id === facultyId)?.name || 'Unknown Faculty';
>>>>>>> 6156905 (Reset database)

        exportTimetablePDF({
            schedules: filteredSchedules,
            blockedSlots,
            rooms: state.rooms,
            title: 'Lecture Timetable',
            session,
            semester,
            faculty: facultyInfo,
            schoolName: 'University of Lagos',
            mode: 'lecture',
        });

        // ✅ LOG PDF EXPORT
        logActivity("EXPORT_PDF");

        addToast({
            type: 'success',
            title: 'PDF Exported',
            message: 'Lecture timetable downloaded as PDF.'
        });
    };

    // Excel export
    const handleExcelExport = async () => {
        try {
            const response = await fetch("http://127.0.0.1:8000/export/excel");
            const blob = await response.blob();

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "lecture_timetable.xlsx";
            a.click();

            // ✅ LOG EXCEL EXPORT
            await logActivity("EXPORT_EXCEL");

            addToast({
                type: 'success',
                title: 'Excel Exported',
                message: 'Lecture timetable downloaded as Excel.'
            });
        } catch (error) {
            addToast({
                type: 'error',
                title: 'Export Failed',
                message: 'Could not export Excel file.'
            });
        }
    };

    if (selectedSemesterId === null) return <TimetableSkeleton />;

    const currentSemester = semesters.find(s => s.id === selectedSemesterId);

    return (
        <div className={styles.page}>

            <div className={styles.pageHeader}>

                {/* STATUS TAG */}
                <div>
                    <span className={currentSemester?.is_current ? styles.draft : styles.final}>
                        {currentSemester?.is_current ? 'DRAFT' : 'FINAL'}
                    </span>
                </div>

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

                    {/* EXCEL */}
                    <button className="btn btn-primary" onClick={handleExcelExport}>
                        Export Excel
                    </button>

                    {/* PDF */}
                    <button className="btn btn-secondary" onClick={handleExportInit}>
                        Export PDF
                    </button>

                </div>
            </div>
<<<<<<< HEAD

            <TimetableGrid
                mode="lecture"
                semesterId={selectedSemesterId}
                readOnly={currentSemester?.is_current === false}
            />

=======
            <TimetableGrid mode="lecture" semesterId={selectedSemesterId} blockedSlots={blockedSlots} readOnly={semesters.find(s => s.id === selectedSemesterId)?.is_current === false} />
>>>>>>> 6156905 (Reset database)
            <ExportModal
                isOpen={isExportModalOpen}
                onClose={() => setIsExportModalOpen(false)}
                onExport={handleExportConfirm}
                mode="lecture"
                sessions={sessions}
            />

        </div>
    );
}